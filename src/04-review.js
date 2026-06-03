(function () {
  'use strict';

  // Review workflow for Coding Journal.
  window.CJ = window.CJ || {};

  var CJ = window.CJ;

  function byId(id) {
    return document.getElementById(id);
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

  function formatUrl(url) {
    if (!url) return 'No problem link saved';

    return String(url)
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '');
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

  function sortDueFirst(cards) {
    return (Array.isArray(cards) ? cards.filter(Boolean) : []).slice().sort(function (a, b) {
      var aDate = parseDateOnly(a && a.sm2 && a.sm2.nextReview);
      var bDate = parseDateOnly(b && b.sm2 && b.sm2.nextReview);
      var aTime = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
      var bTime = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;

      if (aTime !== bTime) return aTime - bTime;

      var aCreated = Date.parse((a && (a.created || a.updated)) || '') || 0;
      var bCreated = Date.parse((b && (b.created || b.updated)) || '') || 0;
      return bCreated - aCreated;
    });
  }

  function getTitle(card) {
    return card && (card.title || card.question || 'Untitled card');
  }

  function renderTags(tags) {
    if (!Array.isArray(tags) || !tags.length) {
      return '<span class="tag">untagged</span>';
    }

    return tags.map(function (tag) {
      return '<span class="tag">' + escapeHtml(tag) + '</span>';
    }).join(' ');
  }

  function ratingLabel(quality) {
    var labels = {
      1: 'Forgot',
      2: 'Vague',
      3: 'Fair',
      4: 'Good',
      5: 'Perfect'
    };

    return labels[quality] || 'Unknown';
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'not scheduled';

    var date = parseDateOnly(dateStr);
    if (!date) return String(dateStr);

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function showReviewArea(html) {
    var reviewArea = byId('reviewArea');
    if (!reviewArea) return null;

    reviewArea.innerHTML = html || '';
    reviewArea.classList.remove('hidden');
    return reviewArea;
  }

  function hideReviewArea() {
    var reviewArea = byId('reviewArea');
    if (!reviewArea) return;

    reviewArea.classList.add('hidden');
    reviewArea.innerHTML = '';
  }

  CJ.review = {
    // State
    sessionCards: [],
    sessionIndex: 0,
    sessionActive: false,
    selectedRating: -1,

    // Start a review session with all due cards.
    startSession: function () {
      if (!CJ.DB || typeof CJ.DB.getDue !== 'function') {
        showReviewArea(
          '<h2>Review unavailable</h2>' +
          '<p class="subtitle">Storage is not ready yet. Try refreshing the page.</p>'
        );
        return;
      }

      this.sessionCards = sortDueFirst(CJ.DB.getDue());
      this.sessionIndex = 0;
      this.sessionActive = true;
      this.selectedRating = -1;

      if (!this.sessionCards.length) {
        this.endSession('Nothing due right now. Nice work!');
        return;
      }

      this.renderCurrentReviewCard();
    },

    // Renderer hook used by CJ.renderer.renderCurrentTab() when the due tab is open.
    renderSession: function (cards) {
      if (this.sessionActive) {
        this.renderCurrentReviewCard();
        return;
      }

      cards = sortDueFirst(cards || (CJ.DB && CJ.DB.getDue ? CJ.DB.getDue() : []));

      if (!cards.length) {
        hideReviewArea();
        return;
      }

      showReviewArea(
        '<h2>Review session ready</h2>' +
        '<p class="subtitle">' + cards.length + ' due card' + (cards.length === 1 ? '' : 's') + '. Start with the oldest review first.</p>' +
        '<p><strong>Next up:</strong> ' + escapeHtml(getTitle(cards[0])) + '</p>' +
        '<button class="btn-submit-review" type="button" onclick="CJ.review.startSession()">Start Review →</button>'
      );
    },

    // Alternate hook name supported by the renderer.
    renderReviewSession: function (cards) {
      this.renderSession(cards);
    },

    // Render the current card in peek mode.
    renderCurrentReviewCard: function () {
      var card = this.sessionCards[this.sessionIndex];

      if (!card) {
        this.endSession();
        return;
      }

      this.selectedRating = -1;

      var current = this.sessionIndex + 1;
      var total = this.sessionCards.length;
      var link = card.link ?
        '<a href="' + escapeHtml(card.link) + '" target="_blank" rel="noopener noreferrer">🔗 ' + escapeHtml(formatUrl(card.link)) + '</a>' :
        '<span>🔗 No problem link saved</span>';

      showReviewArea(
        '<h2>📝 Review Session (' + current + '/' + total + ')</h2>' +
        '<p class="subtitle">Question ' + current + ' of ' + total + '</p>' +
        '<div class="card-title" style="margin-top:14px;font-size:1.35rem">' + escapeHtml(getTitle(card)) + '</div>' +
        '<div class="card-meta">' + link + '</div>' +
        '<div class="card-meta">' +
          '<span>🏷️ ' + renderTags(card.tags) + '</span>' +
          '<span>·</span>' +
          '<span class="tag">' + escapeHtml(card.difficulty || 'medium') + '</span>' +
        '</div>' +
        '<hr style="border:0;border-top:1px solid var(--border);margin:22px 0">' +
        '<p><strong>How well did you recall the approach?</strong></p>' +
        '<p class="subtitle">1 = remembered after seeing answer, 3 = correct with serious difficulty, 5 = perfect response.</p>' +
        '<div class="rating-btns">' + this.renderRatingButtons() + '</div>' +
        '<button id="revealFullCardBtn" class="btn-submit-review" type="button" onclick="CJ.review.revealAndSubmit()" disabled>Reveal Full Card →</button> ' +
        '<button class="btn-ghost" type="button" onclick="CJ.review.cancelSession()">Cancel</button>'
      );
    },

    // Called when a rating button is clicked.
    selectRating: function (quality) {
      var q = parseInt(quality, 10);
      if (isNaN(q)) return;
      q = Math.max(1, Math.min(5, q));

      this.selectedRating = q;

      Array.prototype.forEach.call(document.querySelectorAll('#reviewArea .rating-btns button'), function (button) {
        button.classList.toggle('selected', button.getAttribute('data-quality') === String(q));
      });

      var revealButton = byId('revealFullCardBtn');
      if (revealButton) revealButton.disabled = false;
    },

    // Called when "Reveal Full Card" is clicked.
    revealAndSubmit: function () {
      var card = this.sessionCards[this.sessionIndex];
      var quality = parseInt(this.selectedRating, 10);

      if (!card) {
        this.endSession();
        return;
      }

      if (isNaN(quality) || quality < 1 || quality > 5) {
        if (CJ.renderer && typeof CJ.renderer.showToast === 'function') {
          CJ.renderer.showToast('Pick a rating before revealing the card.');
        }
        return;
      }

      var reviewedCard = CJ.DB && typeof CJ.DB.review === 'function' ? CJ.DB.review(card.id, quality) : null;
      if (!reviewedCard) {
        if (CJ.renderer && typeof CJ.renderer.showToast === 'function') {
          CJ.renderer.showToast('Could not save this review.');
        }
        return;
      }

      this.sessionCards[this.sessionIndex] = reviewedCard;

      var sm2 = reviewedCard.sm2 || {};
      var current = this.sessionIndex + 1;
      var total = this.sessionCards.length;
      var detailHtml = (CJ.renderer && typeof CJ.renderer.renderCardDetail === 'function') ?
        CJ.renderer.renderCardDetail(reviewedCard, true) :
        '';

      showReviewArea(
        '<h2>📝 Review Session (' + current + '/' + total + ')</h2>' +
        '<p class="subtitle">Full card revealed after your recall rating.</p>' +
        '<div class="card-title" style="margin-top:14px;font-size:1.35rem">' + escapeHtml(getTitle(reviewedCard)) + '</div>' +
        '<div class="card-meta">' +
          '<span>Rating: <strong>' + escapeHtml(ratingLabel(quality)) + ' (' + quality + ')</strong></span>' +
          '<span>Next review: <strong>' + escapeHtml(formatDate(sm2.nextReview)) + '</strong></span>' +
          '<span>Interval: ' + escapeHtml(typeof sm2.interval === 'number' ? sm2.interval : 0) + ' day' + (sm2.interval === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<hr style="border:0;border-top:1px solid var(--border);margin:22px 0">' +
        detailHtml +
        '<div class="detail-section" style="margin-top:18px">' +
          '<button class="btn-submit-review" type="button" onclick="CJ.review.nextCard()">Next Card →</button> ' +
          '<button class="btn-ghost" type="button" onclick="CJ.review.cancelSession()">End Session</button>' +
        '</div>'
      );
    },

    // Advance to next card or end session.
    nextCard: function () {
      this.sessionIndex += 1;
      this.selectedRating = -1;

      if (this.sessionIndex < this.sessionCards.length) {
        this.renderCurrentReviewCard();
      } else {
        this.endSession('Session complete! 🎉');
      }
    },

    // End the review session.
    endSession: function (message) {
      var completionMessage = message || 'Session complete! 🎉';

      this.sessionActive = false;
      this.sessionCards = [];
      this.sessionIndex = 0;
      this.selectedRating = -1;

      showReviewArea(
        '<h2>' + escapeHtml(completionMessage) + '</h2>' +
        '<p class="subtitle">Your review stats have been updated.</p>'
      );

      if (CJ.renderer && typeof CJ.renderer.refresh === 'function') {
        CJ.renderer.refresh();
      } else {
        window.setTimeout(hideReviewArea, 1200);
      }
    },

    // Render rating buttons 1-5.
    renderRatingButtons: function () {
      var self = this;
      return [1, 2, 3, 4, 5].map(function (quality) {
        var selectedClass = self.selectedRating === quality ? ' selected' : '';
        return '<button type="button" data-quality="' + quality + '" class="' + selectedClass + '" onclick="CJ.review.selectRating(' + quality + ')">' +
          escapeHtml(ratingLabel(quality)) + ' (' + quality + ')' +
        '</button>';
      }).join('');
    },

    // Cancel session early.
    cancelSession: function () {
      this.endSession();
    },

    // Compatibility aliases for existing renderer fallback hooks.
    start: function () {
      this.startSession();
    },

    reviewNow: function () {
      this.startSession();
    },

    renderCard: function () {
      this.startSession();
    }
  };
})();
