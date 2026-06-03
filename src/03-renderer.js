(function () {
  'use strict';

  // Rendering/template layer for Coding Journal.
  // This file deliberately avoids owning business logic: storage/review math live
  // in CJ.DB and CJ.SM2, while later modules can plug in form/review workflows.
  window.CJ = window.CJ || {};

  var CJ = window.CJ;
  var expandedCards = {};
  var toastTimer = null;

  // Shared tab state. Valid values: due, all, mastered, add.
  CJ.currentTab = CJ.currentTab || 'due';

  function byId(id) {
    return document.getElementById(id);
  }

  function todayString() {
    // Mirrors the data module's YYYY-MM-DD day boundary so renderer status checks
    // match CJ.DB.getDue().
    return new Date().toISOString().split('T')[0];
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJsString(value) {
    // Card IDs are generated locally, but imported data may be arbitrary.
    return String(value === null || value === undefined ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  function parseDateOnly(dateStr) {
    if (!dateStr) return null;

    var match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    var date = new Date(Date.UTC(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10)
    ));

    return isNaN(date.getTime()) ? null : date;
  }

  function daysBetween(dateA, dateB) {
    return Math.round((dateA.getTime() - dateB.getTime()) / (24 * 60 * 60 * 1000));
  }

  function normalizeCards(cards) {
    return Array.isArray(cards) ? cards.filter(Boolean) : [];
  }

  function getSm2(card) {
    return (card && card.sm2) || {};
  }

  function getTitle(card) {
    return card && (card.title || card.question || 'Untitled card');
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = value;
  }

  function plural(count, one, many) {
    return count === 1 ? one : (many || one + 's');
  }

  function truncate(value, length) {
    var text = String(value || '');
    if (!text || text.length <= length) return text;
    return text.slice(0, Math.max(0, length - 1)) + '…';
  }

  function emptyStateMarkup(message, subMessage) {
    return '' +
      '<div class="empty">' +
        escapeHtml(message || 'Nothing here yet.') +
        (subMessage ? '<small>' + escapeHtml(subMessage) + '</small>' : '') +
      '</div>';
  }

  function sortNewestFirst(cards) {
    return normalizeCards(cards).slice().sort(function (a, b) {
      var aTime = Date.parse(a.created || a.updated || '') || 0;
      var bTime = Date.parse(b.created || b.updated || '') || 0;
      return bTime - aTime;
    });
  }

  function sortDueFirst(cards) {
    // Older nextReview dates first: most overdue -> today -> nearest future.
    return normalizeCards(cards).slice().sort(function (a, b) {
      var aDate = parseDateOnly(getSm2(a).nextReview);
      var bDate = parseDateOnly(getSm2(b).nextReview);
      var aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
      var bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;

      if (aTime !== bTime) return aTime - bTime;

      // Stable-feeling tiebreaker: newest cards first within the same due day.
      var aCreated = Date.parse(a.created || a.updated || '') || 0;
      var bCreated = Date.parse(b.created || b.updated || '') || 0;
      return bCreated - aCreated;
    });
  }

  function isDue(card) {
    var nextReview = getSm2(card).nextReview;
    return !!nextReview && nextReview <= todayString();
  }

  function tagsMarkup(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return '<span class="tag">untagged</span>';
    }

    return tags.map(function (tag) {
      return '<span class="tag">' + escapeHtml(tag) + '</span>';
    }).join(' ');
  }

  function difficultyMarkup(difficulty) {
    var value = difficulty || 'medium';
    return '<span class="tag">' + escapeHtml(value) + '</span>';
  }

  function linkMarkup(link) {
    if (!link) return '<span>link: none</span>';

    return '' +
      '<span>link: ' +
        '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer" ' +
          'title="' + escapeHtml(link) + '" onclick="event.stopPropagation()">' +
          escapeHtml(truncate(link, 28)) +
        '</a>' +
      '</span>';
  }

  function renderReviewPrompt(cards) {
    var reviewArea = byId('reviewArea');
    if (!reviewArea) return;

    cards = sortDueFirst(cards);

    if (!cards.length) {
      reviewArea.classList.add('hidden');
      reviewArea.innerHTML = '';
      return;
    }

    // If the dedicated review module has been loaded, let it own the session UI.
    // Different phases may choose different method names, so this stays flexible.
    if (CJ.review) {
      try {
        if (typeof CJ.review.renderSession === 'function') {
          CJ.review.renderSession(cards);
          reviewArea.classList.remove('hidden');
          return;
        }
        if (typeof CJ.review.renderReviewSession === 'function') {
          CJ.review.renderReviewSession(cards);
          reviewArea.classList.remove('hidden');
          return;
        }
      } catch (error) {
        console.warn('Coding Journal: review renderer failed; using fallback prompt.', error);
      }
    }

    var first = cards[0];
    var count = cards.length;

    reviewArea.classList.remove('hidden');
    reviewArea.innerHTML = '' +
      '<h2>Review session ready</h2>' +
      '<p class="subtitle">' + count + ' ' + plural(count, 'card') + ' due. Start with the oldest review first.</p>' +
      '<p><strong>Next up:</strong> ' + escapeHtml(getTitle(first)) + '</p>' +
      '<button class="btn-submit-review" type="button" onclick="CJ.renderer.handleReviewNow(\'' + escapeJsString(first.id) + '\')">Review Now</button>';
  }

  function hideReviewPrompt() {
    var reviewArea = byId('reviewArea');
    if (!reviewArea) return;

    reviewArea.classList.add('hidden');
    reviewArea.innerHTML = '';
  }

  CJ.renderer = {
    // Refresh everything visible on the page.
    refresh: function () {
      this.refreshStats();
      this.refreshTabCounts();
      this.refreshDueBadge();
      this.renderCurrentTab();
    },

    // Render a list of cards into #content. When options.showDue is true, the
    // review session area above the tabs is also shown for non-empty due lists.
    renderCardList: function (cards, options) {
      options = options || {};
      cards = normalizeCards(cards);

      var content = byId('content');
      if (!content) return;

      if (options.showDue && cards.length) {
        renderReviewPrompt(cards);
      } else {
        hideReviewPrompt();
      }

      if (!cards.length) {
        var emptyMessage = options.emptyMessage || 'No cards found.';
        var emptySubMessage = options.emptySubMessage || '';
        content.innerHTML = emptyStateMarkup(emptyMessage, emptySubMessage);
        return;
      }

      content.innerHTML = cards.map(function (card) {
        return CJ.renderer.renderCard(card);
      }).join('');
    },

    // Render a single collapsed/expanded card shell.
    renderCard: function (card) {
      if (!card) return '';

      var sm2 = getSm2(card);
      var status = this.getCardStatus(card);
      var repetitions = typeof sm2.repetitions === 'number' ? sm2.repetitions : 0;
      var nextReview = sm2.nextReview ? this.formatRelativeDate(sm2.nextReview) : 'not scheduled';
      var cardId = escapeJsString(card.id);
      var isOpen = !!expandedCards[card.id];

      return '' +
        '<div class="card" data-card-id="' + escapeHtml(card.id) + '" onclick="CJ.renderer.toggleCard(\'' + cardId + '\')">' +
          '<div class="card-header">' +
            '<div>' +
              '<div class="card-title">' + escapeHtml(getTitle(card)) + ' ' + difficultyMarkup(card.difficulty) + '</div>' +
              '<div class="card-meta">' +
                '<span>tags: ' + tagsMarkup(card.tags) + '</span>' +
              '</div>' +
              '<div class="card-meta">' +
                linkMarkup(card.link) +
                '<span>Reps: ' + escapeHtml(repetitions) + '</span>' +
                '<span>Next: ' + escapeHtml(nextReview) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="' + escapeHtml(status.className) + '">' + escapeHtml(status.text) + '</div>' +
          '</div>' +
          this.renderCardDetail(card, isOpen) +
        '</div>';
    },

    // Render the expanded detail block for a card. It is always present in the
    // DOM; the .open class decides whether it is visible.
    renderCardDetail: function (card, forceOpen) {
      if (!card) return '';

      var due = isDue(card);
      var openClass = forceOpen ? ' open' : '';
      var cardId = escapeJsString(card.id);
      var notes = card.notes ? '' +
        '<div class="detail-section">' +
          '<h3>Notes</h3>' +
          '<div>' + escapeHtml(card.notes).replace(/\n/g, '<br>') + '</div>' +
        '</div>' : '';

      return '' +
        '<div class="detail' + openClass + '" onclick="event.stopPropagation()">' +
          '<div class="detail-section">' +
            '<h3>Your code</h3>' +
            '<pre><code>' + escapeHtml(card.actual_code || card.code || '') + '</code></pre>' +
          '</div>' +
          '<div class="detail-section">' +
            '<h3>My thinking</h3>' +
            '<div>' + (card.my_thinking ? escapeHtml(card.my_thinking).replace(/\n/g, '<br>') : '<em>No thinking notes yet.</em>') + '</div>' +
          '</div>' +
          '<div class="detail-section">' +
            '<h3>Right thinking</h3>' +
            '<div>' + (card.right_thinking ? escapeHtml(card.right_thinking).replace(/\n/g, '<br>') : '<em>No right-thinking notes yet.</em>') + '</div>' +
          '</div>' +
          notes +
          '<div class="detail-section">' +
            (due ? '<button class="btn-primary" type="button" onclick="CJ.renderer.handleReviewNow(\'' + cardId + '\')">Review Now</button> ' : '') +
            '<button class="btn-ghost" type="button" onclick="CJ.renderer.handleDelete(\'' + cardId + '\')">Delete</button>' +
          '</div>' +
        '</div>';
    },

    // Render empty state into #content.
    renderEmpty: function (message, subMessage) {
      var content = byId('content');
      hideReviewPrompt();
      if (content) content.innerHTML = emptyStateMarkup(message, subMessage);
    },

    // Human-friendly relative date for card schedules.
    formatRelativeDate: function (dateStr) {
      if (!dateStr) return '';

      var target = parseDateOnly(dateStr);
      var today = parseDateOnly(todayString());
      if (!target || !today) return String(dateStr);

      var diff = daysBetween(target, today);
      if (diff === 0) return 'today';
      if (diff === 1) return 'tomorrow';
      if (diff > 1) return 'in ' + diff + ' days';
      if (diff === -1) return '1 day ago';
      return Math.abs(diff) + ' days ago';
    },

    // Programmatic tab switch. The scaffold's inline onclick handlers call the
    // global switchTab wrapper defined at the bottom of this file.
    switchTab: function (tabName) {
      var validTabs = { due: true, all: true, mastered: true, add: true };
      if (!validTabs[tabName]) tabName = 'due';

      CJ.currentTab = tabName;
      expandedCards = {};

      Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (tab) {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
      });

      this.renderCurrentTab();
    },

    renderCurrentTab: function () {
      var tab = CJ.currentTab || 'due';

      if (!CJ.DB) {
        this.renderEmpty('Storage is not ready.', 'Try refreshing after all modules have loaded.');
        return;
      }

      if (tab === 'due') {
        var dueCards = sortDueFirst(CJ.DB.getDue());
        this.renderCardList(dueCards, {
          showDue: true,
          emptyMessage: 'Nothing due right now.',
          emptySubMessage: 'Nice work — your reviews are caught up.'
        });
        return;
      }

      if (tab === 'all') {
        this.renderCardList(sortNewestFirst(CJ.DB.getAll()), {
          emptyMessage: 'No cards yet.',
          emptySubMessage: 'Use + New to add your first coding journal card.'
        });
        return;
      }

      if (tab === 'mastered') {
        this.renderCardList(sortDueFirst(CJ.DB.getMastered()), {
          emptyMessage: 'No mastered cards yet.',
          emptySubMessage: 'Cards become mastered after 5 successful repetitions.'
        });
        return;
      }

      if (tab === 'add') {
        hideReviewPrompt();
        try {
          if (CJ.form && typeof CJ.form.renderAddForm === 'function') {
            CJ.form.renderAddForm();
          } else {
            this.renderEmpty('Add form is still loading.', 'The form module will render here once Phase 5 is available.');
          }
        } catch (error) {
          console.warn('Coding Journal: failed to render add form.', error);
          this.renderEmpty('Could not render the add form.', 'Check the console for details.');
        }
      }
    },

    refreshStats: function () {
      if (!CJ.DB) return;

      setText('statTotal', CJ.DB.getAll().length);
      setText('statDue', CJ.DB.getDue().length);
      setText('statMastered', CJ.DB.getMastered().length);
      setText('statStreak', CJ.DB.getStreak());
    },

    refreshTabCounts: function () {
      if (!CJ.DB) return;

      setText('tDue', CJ.DB.getDue().length);
      setText('tAll', CJ.DB.getAll().length);
      setText('tMastered', CJ.DB.getMastered().length);
    },

    refreshDueBadge: function () {
      if (!CJ.DB) return;

      var count = CJ.DB.getDue().length;
      setText('dueBadge', count + ' due');
    },

    // Get the card's SM-2 status text/class. Mastered wins first so long-running
    // cards keep their celebratory label even if they are due for maintenance.
    getCardStatus: function (card) {
      var sm2 = getSm2(card);
      var repetitions = typeof sm2.repetitions === 'number' ? sm2.repetitions : 0;
      var nextReview = sm2.nextReview;
      var today = todayString();

      if (repetitions >= 5) {
        return { text: 'Mastered', className: 'card-mastered' };
      }

      if (nextReview && nextReview < today) {
        return { text: 'Overdue', className: 'card-overdue' };
      }

      if (nextReview && nextReview <= today) {
        return { text: 'Due', className: 'card-due' };
      }

      return { text: nextReview ? 'Next ' + this.formatRelativeDate(nextReview) : 'New', className: 'card-due' };
    },

    toggleCard: function (id) {
      expandedCards[id] = !expandedCards[id];
      this.renderCurrentTab();
    },

    handleReviewNow: function (id) {
      if (window.event && typeof window.event.stopPropagation === 'function') {
        window.event.stopPropagation();
      }

      if (CJ.review) {
        if (typeof CJ.review.start === 'function') {
          CJ.review.start(id);
          return;
        }
        if (typeof CJ.review.reviewNow === 'function') {
          CJ.review.reviewNow(id);
          return;
        }
        if (typeof CJ.review.renderCard === 'function') {
          CJ.review.renderCard(id);
          return;
        }
      }

      this.showToast('Review workflow is not loaded yet.');
    },

    handleDelete: function (id) {
      if (window.event && typeof window.event.stopPropagation === 'function') {
        window.event.stopPropagation();
      }

      if (!CJ.DB || typeof CJ.DB.delete !== 'function') {
        this.showToast('Delete is not available yet.');
        return;
      }

      if (!window.confirm('Delete this card? This cannot be undone.')) return;

      if (CJ.DB.delete(id)) {
        delete expandedCards[id];
        this.showToast('Card deleted.');
        this.refresh();
      } else {
        this.showToast('Card not found.');
      }
    },

    showToast: function (message) {
      var toast = byId('toast');
      if (!toast) return;

      toast.textContent = message || '';
      toast.classList.add('show');

      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toast.classList.remove('show');
      }, 2600);
    }
  };

  // Scaffold compatibility: inline tab handlers call switchTab('due'), etc.
  window.switchTab = function (tabName) {
    CJ.renderer.switchTab(tabName);
  };
})();
