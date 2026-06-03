(function () {
  'use strict';

  window.CJ = window.CJ || {};

  var CJ = window.CJ;

  function byId(id) {
    return document.getElementById(id);
  }

  function getCardTitle(card) {
    if (!card) return 'this card';
    return card.question || card.title || 'Untitled card';
  }

  function showError(message, error) {
    if (error && window.console && typeof window.console.warn === 'function') {
      window.console.warn('Coding Journal: ' + message, error);
    }

    if (CJ.utils && typeof CJ.utils.showToast === 'function') {
      CJ.utils.showToast(message);
    }
  }

  CJ.utils = {
    _toastTimer: null,
    _toastHideTimer: null,
    _initialized: false,

    // ===== TOAST =====
    showToast: function (message, duration) {
      duration = duration || 2500;

      var el = byId('toast');
      if (!el) return;

      el.textContent = message || '';
      el.classList.remove('hidden');
      el.classList.add('show');

      if (this._toastTimer) window.clearTimeout(this._toastTimer);
      if (this._toastHideTimer) window.clearTimeout(this._toastHideTimer);

      this._toastTimer = window.setTimeout(function () {
        el.classList.remove('show');

        // Keep it hidden via hidden class after animation.
        CJ.utils._toastHideTimer = window.setTimeout(function () {
          el.classList.add('hidden');
        }, 300);
      }, duration);
    },

    // ===== EXPORT =====
    exportData: function () {
      if (!CJ.DB || typeof CJ.DB.load !== 'function') {
        this.showToast('Export is not available yet.');
        return;
      }

      var data = CJ.DB.load();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');

      a.href = url;
      a.download = 'coding-journal-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast('📦 Exported!');
    },

    // ===== IMPORT =====
    importData: function (file) {
      var self = this;

      if (!file) return;

      if (!CJ.DB || typeof CJ.DB.save !== 'function') {
        self.showToast('Import is not available yet.');
        return;
      }

      var reader = new FileReader();

      reader.onload = function (event) {
        var parsed;

        try {
          parsed = JSON.parse(event.target.result);
        } catch (error) {
          showError('Invalid JSON file.', error);
          return;
        }

        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
          self.showToast('Invalid backup file: missing cards array.');
          return;
        }

        var currentCount = CJ.DB.getAll ? CJ.DB.getAll().length : (CJ.DB.load().cards || []).length;
        var importedCount = parsed.cards.length;
        var confirmed = window.confirm('Replace ' + currentCount + ' cards with ' + importedCount + ' cards from file?');

        if (!confirmed) return;

        CJ.DB.save(parsed);
        self.showToast('Imported ' + importedCount + ' cards!');

        if (CJ.renderer && typeof CJ.renderer.refresh === 'function') {
          CJ.renderer.refresh();
        }
      };

      reader.onerror = function (error) {
        showError('Could not read import file.', error);
      };

      reader.readAsText(file);
    },

    // ===== DELETE CARD =====
    deleteCard: function (id) {
      if (!CJ.DB || typeof CJ.DB.delete !== 'function') {
        this.showToast('Delete is not available yet.');
        return;
      }

      var cards = CJ.DB.getAll ? CJ.DB.getAll() : [];
      var card = cards.find(function (item) {
        return item && item.id === id;
      });
      var question = getCardTitle(card);

      if (!window.confirm("Delete '" + question + "'?")) return;

      if (CJ.DB.delete(id)) {
        this.showToast('Deleted!');

        if (CJ.renderer && typeof CJ.renderer.refresh === 'function') {
          CJ.renderer.refresh();
        }
      } else {
        this.showToast('Card not found.');
      }
    },

    // ===== INIT =====
    init: function () {
      var exportBtn = byId('exportBtn');
      var importBtn = byId('importBtn');
      var importInput = byId('importInput');
      var hadCards = !!(CJ.DB && typeof CJ.DB.getAll === 'function' && CJ.DB.getAll().length > 0);

      if (!this._initialized) {
        if (exportBtn) {
          exportBtn.addEventListener('click', function () {
            CJ.utils.exportData();
          });
        }

        if (importBtn && importInput) {
          importBtn.addEventListener('click', function () {
            importInput.click();
          });
        }

        if (importInput) {
          importInput.addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            CJ.utils.importData(file);
            event.target.value = '';
          });
        }

        this._initialized = true;
      }

      CJ.currentTab = 'due';

      if (CJ.renderer && typeof CJ.renderer.refresh === 'function') {
        CJ.renderer.refresh();
      }

      if (!hadCards) {
        this.showToast('Welcome! Add your first card with + New.');
      }
    }
  };

  // If an earlier renderer build did not provide toast support, expose the same
  // utility implementation there for modules that call CJ.renderer.showToast().
  if (!CJ.renderer) CJ.renderer = {};
  if (typeof CJ.renderer.showToast !== 'function') {
    CJ.renderer.showToast = function (message, duration) {
      CJ.utils.showToast(message, duration);
    };
  }

  // Scaffold compatibility: inline handlers in the HTML call these globals.
  window.switchTab = function (tabName) {
    if (CJ.renderer && typeof CJ.renderer.switchTab === 'function') {
      CJ.renderer.switchTab(tabName);
    }
  };

  window.startReviewSession = function () {
    if (CJ.review && typeof CJ.review.startSession === 'function') {
      CJ.review.startSession();
    }
  };
})();
