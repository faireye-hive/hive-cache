// src/ui/hybridSyncModal.js

import {
  getReputationCacheStats,
  clearReputationCache,
  fetchReputationsRpcBatch,
  syncAllWithHafsql,
} from '../api/reputationService.js';
import { syncBlockchainRpcFromNetwork, syncBlockchainFromNetwork } from '../api/dataLoader.js';
import {
  allPosts,
  getReputationSyncMode,
  setReputationSyncMode,
  getMaxReputationFilter,
  setMaxReputationFilter,
} from '../config.js';
import { showNotification } from './notifications.js';
import { refreshPostsDisplay } from './domHelpers.js';

/**
 * Cria dinamicamente e inicializa o Modal de Sincronização Híbrida & Reputação
 */
export function initHybridSyncModal() {
  ensureModalHtml();

  const modal = document.getElementById('hybridSyncModal');
  const closeBtn = document.getElementById('closeHybridSyncModal');
  const openBtn = document.getElementById('hybridSyncBtn');
  const syncRpcBtn = document.getElementById('syncRpcBtn');

  if (openBtn) {
    openBtn.addEventListener('click', () => openHybridSyncModal());
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  // Ação rápida da toolbar: Sincronizar via RPC Direto (Sem HAFSQL)
  if (syncRpcBtn) {
    syncRpcBtn.addEventListener('click', async () => {
      const origHtml = syncRpcBtn.innerHTML;
      try {
        syncRpcBtn.disabled = true;
        syncRpcBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
        await syncBlockchainRpcFromNetwork(20);
      } catch (e) {
        // Erro já tratado e notificado
      } finally {
        syncRpcBtn.disabled = false;
        syncRpcBtn.innerHTML = origHtml;
      }
    });
  }

  // Listeners dos botões internos do modal
  bindModalActions();
}

/**
 * Garante que o HTML do modal exista no DOM
 */
function ensureModalHtml() {
  if (document.getElementById('hybridSyncModal')) return;

  const modalDiv = document.createElement('div');
  modalDiv.id = 'hybridSyncModal';
  modalDiv.className = 'modal hidden';
  modalDiv.innerHTML = `
    <div class="modal-content hybrid-sync-modal-box" style="max-width: 680px;">
      <div class="modal-header">
        <h2><i class="fas fa-layer-group" style="color: #8e44ad;"></i> Sincronização Híbrida & Reputação</h2>
        <span class="close" id="closeHybridSyncModal">&times;</span>
      </div>

      <div class="modal-body">
        <p class="section-desc" style="color: var(--text-secondary); margin-bottom: 1.2rem; font-size: 0.95rem;">
          Sistema de dados híbrido: salve no cache local, sincronize novos dados com os nós RPC nativos da Hive (sem depender do banco HAFSQL) ou realize uma sincronização total com HAFSQL quando desejar.
        </p>

        <!-- BLOCO 1: Sincronização de Posts da Blockchain -->
        <div class="sync-card" style="background: var(--bg-tertiary, #f8f9fa); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="margin-top: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-cubes" style="color: #3498db;"></i> Posts & Comentários da Blockchain
          </h3>
          <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 12px;">
            Escolha como deseja sincronizar os posts com o cache local (<code>data.json</code>):
          </p>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" id="btnModalSyncRpc" class="btn-action" style="background-color: #3498db; color: #fff; flex: 1; min-width: 220px;">
              <i class="fas fa-bolt"></i> Sincronizar via RPC (Sem HAFSQL)
            </button>
            <button type="button" id="btnModalSyncHafsql" class="btn-action" style="background-color: #27ae60; color: #fff; flex: 1; min-width: 220px;">
              <i class="fas fa-database"></i> Atualizar Tudo (HAFSQL 24h)
            </button>
          </div>
          <div id="postsSyncStatus" style="margin-top: 10px; font-size: 0.85rem; color: var(--text-secondary); display: none;"></div>
        </div>

        <!-- BLOCO 2: Sincronização de Reputação dos Autores -->
        <div class="sync-card" style="background: var(--bg-tertiary, #f8f9fa); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="margin-top: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-medal" style="color: #f39c12;"></i> Reputação dos Autores (Sistema Híbrido)
          </h3>
          <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 10px;">
            As pontuações ficam salvas no seu navegador (cache instantâneo). Atualize quando quiser com a Hive API ou com a HAFSQL.
          </p>

          <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-primary, #fff); padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border-color, #e2e8f0); margin-bottom: 12px;">
            <div>
              <strong style="font-size: 0.9rem;">Status do Cache de Reputação:</strong>
              <div id="repCacheStatsText" style="font-size: 0.82rem; color: var(--text-secondary);">Carregando...</div>
            </div>
            <button type="button" id="btnClearRepCache" class="btn-action btn-danger" style="padding: 6px 12px; font-size: 0.82rem;">
              <i class="fas fa-trash"></i> Limpar Cache Rep
            </button>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
            <button type="button" id="btnSyncRepRpc" class="btn-action" style="background-color: #2980b9; color: #fff; flex: 1; min-width: 220px;">
              <i class="fas fa-bolt"></i> Sincronizar Reputações (RPC Sem HAFSQL)
            </button>
            <button type="button" id="btnSyncRepHafsql" class="btn-action" style="background-color: #d35400; color: #fff; flex: 1; min-width: 220px;">
              <i class="fas fa-sync-alt"></i> Atualizar Todas com HAFSQL
            </button>
          </div>

          <!-- Barra de Progresso de Reputação -->
          <div id="repProgressBarContainer" style="display: none; margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 4px;">
              <span id="repProgressLabel">Sincronizando reputações...</span>
              <span id="repProgressPercent">0%</span>
            </div>
            <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
              <div id="repProgressBarFill" style="width: 0%; height: 100%; background: #3498db; transition: width 0.2s;"></div>
            </div>
          </div>
        </div>

        <!-- BLOCO 3: Preferência de Modo de Consulta -->
        <div class="sync-card" style="background: var(--bg-tertiary, #f8f9fa); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 16px;">
          <h3 style="margin-top: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-cog" style="color: #7f8c8d;"></i> Modo Padrão de Consulta de Reputação
          </h3>
          <div style="display: flex; gap: 20px; margin-top: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem;">
              <input type="radio" name="repSyncModeRadio" value="hybrid_rpc" id="modeRadioRpc">
              <span><strong>Modo Híbrido RPC</strong> (Leve, rápido, sem depender de HAFSQL)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem;">
              <input type="radio" name="repSyncModeRadio" value="hafsql" id="modeRadioHafsql">
              <span><strong>Modo HAFSQL</strong> (Prioriza nós do microserviço HAFSQL)</span>
            </label>
          </div>
        </div>

      </div>

      <div class="modal-footer" style="padding: 14px 20px; display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn-secondary" id="btnDoneHybridSync">Concluído</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalDiv);
}

/**
 * Atualiza e abre o Modal de Sincronização Híbrida
 */
export function openHybridSyncModal() {
  ensureModalHtml();
  const modal = document.getElementById('hybridSyncModal');
  if (!modal) return;

  updateCacheStatsDisplay();

  const currentMode = getReputationSyncMode();
  const rpcRadio = document.getElementById('modeRadioRpc');
  const hafsqlRadio = document.getElementById('modeRadioHafsql');
  if (rpcRadio && hafsqlRadio) {
    rpcRadio.checked = currentMode === 'hybrid_rpc';
    hafsqlRadio.checked = currentMode === 'hafsql';
  }

  modal.classList.remove('hidden');
}

function updateCacheStatsDisplay() {
  const statsEl = document.getElementById('repCacheStatsText');
  if (!statsEl) return;
  const stats = getReputationCacheStats();
  statsEl.textContent = `${stats.memoryCount} autores em memória, ${stats.storageCount} salvos no armazenamento local (válidos por ${stats.ttlDays} dias).`;
}

function bindModalActions() {
  const modal = document.getElementById('hybridSyncModal');
  const doneBtn = document.getElementById('btnDoneHybridSync');
  if (doneBtn && modal) {
    doneBtn.addEventListener('click', () => modal.classList.add('hidden'));
  }

  // Modo RPC para posts (Sem HAFSQL)
  const btnSyncRpc = document.getElementById('btnModalSyncRpc');
  if (btnSyncRpc) {
    btnSyncRpc.addEventListener('click', async () => {
      const orig = btnSyncRpc.innerHTML;
      try {
        btnSyncRpc.disabled = true;
        btnSyncRpc.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando via RPC...';
        await syncBlockchainRpcFromNetwork(20);
      } finally {
        btnSyncRpc.disabled = false;
        btnSyncRpc.innerHTML = orig;
      }
    });
  }

  // Atualizar tudo com HAFSQL
  const btnSyncHafsql = document.getElementById('btnModalSyncHafsql');
  if (btnSyncHafsql) {
    btnSyncHafsql.addEventListener('click', async () => {
      const orig = btnSyncHafsql.innerHTML;
      try {
        btnSyncHafsql.disabled = true;
        btnSyncHafsql.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Baixando HAFSQL...';
        await syncBlockchainFromNetwork(24);
      } finally {
        btnSyncHafsql.disabled = false;
        btnSyncHafsql.innerHTML = orig;
      }
    });
  }

  // Limpar cache de reputações
  const btnClearRep = document.getElementById('btnClearRepCache');
  if (btnClearRep) {
    btnClearRep.addEventListener('click', () => {
      if (confirm('Deseja limpar todo o cache local de reputações de autores?')) {
        clearReputationCache();
        updateCacheStatsDisplay();
        refreshPostsDisplay();
        showNotification('Cache de reputação limpo com sucesso!', 'success');
      }
    });
  }

  // Sincronizar reputações em lote via RPC (Sem HAFSQL)
  const btnSyncRepRpc = document.getElementById('btnSyncRepRpc');
  if (btnSyncRepRpc) {
    btnSyncRepRpc.addEventListener('click', async () => {
      const authors = allPosts.map((p) => p.author).filter(Boolean);
      if (authors.length === 0) {
        showNotification('Nenhum autor para sincronizar.', 'warning');
        return;
      }

      const orig = btnSyncRepRpc.innerHTML;
      try {
        btnSyncRepRpc.disabled = true;
        btnSyncRepRpc.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando RPC...';
        showNotification(`Sincronizando reputações de ${authors.length} posts via Hive RPC (sem HAFSQL)...`, 'info');

        await fetchReputationsRpcBatch(authors, true);
        updateCacheStatsDisplay();
        refreshPostsDisplay();
        showNotification('Reputações sincronizadas com sucesso via nós RPC!', 'success');
      } catch (e) {
        showNotification(`Erro ao sincronizar via RPC: ${e.message}`, 'error');
      } finally {
        btnSyncRepRpc.disabled = false;
        btnSyncRepRpc.innerHTML = orig;
      }
    });
  }

  // Atualizar todas com HAFSQL
  const btnSyncRepHafsql = document.getElementById('btnSyncRepHafsql');
  if (btnSyncRepHafsql) {
    btnSyncRepHafsql.addEventListener('click', async () => {
      const authors = allPosts.map((p) => p.author).filter(Boolean);
      if (authors.length === 0) {
        showNotification('Nenhum autor para atualizar.', 'warning');
        return;
      }

      const orig = btnSyncRepHafsql.innerHTML;
      const progressBox = document.getElementById('repProgressBarContainer');
      const progressLabel = document.getElementById('repProgressLabel');
      const progressPercent = document.getElementById('repProgressPercent');
      const progressBarFill = document.getElementById('repProgressBarFill');

      if (progressBox) progressBox.style.display = 'block';

      try {
        btnSyncRepHafsql.disabled = true;
        btnSyncRepHafsql.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando com HAFSQL...';

        const result = await syncAllWithHafsql(authors, (done, total, lastAuthor, lastScore) => {
          const pct = Math.round((done / total) * 100);
          if (progressPercent) progressPercent.textContent = `${pct}% (${done}/${total})`;
          if (progressBarFill) progressBarFill.style.width = `${pct}%`;
          if (progressLabel) progressLabel.textContent = `Atualizando @${lastAuthor} (${lastScore})...`;
        });

        updateCacheStatsDisplay();
        refreshPostsDisplay();
        showNotification(`Atualização HAFSQL concluída! ${result.updatedCount} autores atualizados.`, 'success');
      } catch (e) {
        showNotification(`Erro na atualização com HAFSQL: ${e.message}`, 'error');
      } finally {
        btnSyncRepHafsql.disabled = false;
        btnSyncRepHafsql.innerHTML = orig;
        if (progressBox) {
          setTimeout(() => {
            progressBox.style.display = 'none';
            if (progressBarFill) progressBarFill.style.width = '0%';
          }, 2500);
        }
      }
    });
  }

  // Radio button de modo padrão
  const rpcRadio = document.getElementById('modeRadioRpc');
  const hafsqlRadio = document.getElementById('modeRadioHafsql');

  if (rpcRadio) {
    rpcRadio.addEventListener('change', () => {
      if (rpcRadio.checked) {
        setReputationSyncMode('hybrid_rpc');
        showNotification('Modo Híbrido RPC ativado (sem HAFSQL por padrão).', 'info');
      }
    });
  }

  if (hafsqlRadio) {
    hafsqlRadio.addEventListener('change', () => {
      if (hafsqlRadio.checked) {
        setReputationSyncMode('hafsql');
        showNotification('Modo HAFSQL ativado.', 'info');
      }
    });
  }
}
