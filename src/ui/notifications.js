// src/ui/notifications.js

// Mova a função showNotification para cá
export function showNotification(message, type = "info") {
  // ... corpo da função showNotification ...
  const oldNotifications = document.querySelectorAll(".notification");
  oldNotifications.forEach((n) => {
    if (n.parentNode) n.parentNode.removeChild(n);
  });

  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;

  let icon = "info-circle";
  if (type === "success") icon = "check-circle";
  else if (type === "error") icon = "exclamation-circle";
  else if (type === "warning") icon = "exclamation-triangle";

  notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;

  notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : type === "warning" ? "#f39c12" : "#3498db"};
        color: white;
        border-radius: 5px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        max-width: 400px;
    `;

  document.body.appendChild(notification);

  setTimeout(() => {
    // Você precisaria garantir que as keyframes slideIn e slideOut estão no seu CSS
    notification.style.animation = "slideOut 0.3s ease-out";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}