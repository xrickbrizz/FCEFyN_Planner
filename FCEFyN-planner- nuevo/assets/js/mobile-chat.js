(() => {
  const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
  if (!isMobile()) return;

  const mensajesTab = document.getElementById("tab-mensajes");
  if (!mensajesTab) return;

  const messagesList = document.getElementById("messagesList");
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("btnSendMessage");
  const backBtn = mensajesTab.querySelector(".mobile-chat-back");

  const setThreadOpen = (open) => {
    mensajesTab.classList.toggle("is-thread", open);
    if (open && messagesList) {
      requestAnimationFrame(() => {
        messagesList.scrollTop = messagesList.scrollHeight;
      });
    }
  };

  const openThread = () => setThreadOpen(true);
  const closeThread = () => setThreadOpen(false);

  document.addEventListener("click", (event) => {
    const target = event.target;
    const chatRow = target.closest("#tab-mensajes .chat-item");
    if (!chatRow) return;
    const isButton = target.closest("button");
    if (!isButton) {
      chatRow.querySelector("button")?.click();
    }
    openThread();
  });

  backBtn?.addEventListener("click", closeThread);

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-section='mensajes']");
    if (btn) closeThread();
  });

  sendBtn?.addEventListener("click", () => {
    if (!messagesList) return;
    setTimeout(() => {
      messagesList.scrollTop = messagesList.scrollHeight;
    }, 120);
  });

  messageInput?.addEventListener("focus", () => {
    messageInput.scrollIntoView({ block: "center" });
    if (messagesList) {
      messagesList.scrollTop = messagesList.scrollHeight;
    }
  });
})();
