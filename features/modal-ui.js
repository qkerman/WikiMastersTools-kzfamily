(() => {
  const registry = window.__wmAverageFeatures ||= {};

  registry.modalUi = {
    create() {
      function showInfoModal(titleText, message) {
        const overlay = document.createElement('div');
        overlay.className = 'wm-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'wm-modal wm-confirm-modal';

        const title = document.createElement('h2');
        title.textContent = titleText;

        const text = document.createElement('p');
        text.textContent = message;

        const actions = document.createElement('div');
        actions.className = 'wm-modal-actions';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wm-tool-button';
        closeButton.textContent = 'Fermer';

        const close = () => overlay.remove();
        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close();
        });

        actions.append(closeButton);
        modal.append(title, text, actions);
        overlay.append(modal);
        document.body.append(overlay);
      }



      return { showInfoModal };
    }
  };
})();
