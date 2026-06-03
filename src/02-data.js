(function () {
  'use strict';

  // Coding Journal namespace. Later merge phases can safely extend window.CJ.
  window.CJ = window.CJ || {};

  var STORAGE_KEY = 'coding_journal';
  var DATA_VERSION = 1;

  function todayString() {
    return new Date().toISOString().split('T')[0];
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function addDays(dateString, days) {
    var date = new Date(dateString + 'T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split('T')[0];
  }

  function uniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeData(data) {
    if (!data || typeof data !== 'object') {
      return {
        cards: [],
        version: DATA_VERSION,
        created: isoNow()
      };
    }

    if (!Array.isArray(data.cards)) data.cards = [];
    if (!data.version) data.version = DATA_VERSION;
    if (!data.created) data.created = isoNow();

    return data;
  }

  // ===== SM-2 ENGINE =====
  window.CJ.SM2 = {
    defaultEF: 2.5,
    minEF: 1.3,

    newCard: function () {
      return {
        easinessFactor: this.defaultEF,
        interval: 0,
        repetitions: 0,
        nextReview: todayString(),
        lastReview: null,
        lastQuality: null
      };
    },

    calc: function (quality, prevSm2) {
      var q = parseInt(quality, 10);
      if (isNaN(q)) q = 0;
      q = Math.max(0, Math.min(5, q));

      var prev = prevSm2 || this.newCard();
      var prevEF = typeof prev.easinessFactor === 'number' ? prev.easinessFactor : this.defaultEF;
      var prevInterval = typeof prev.interval === 'number' ? prev.interval : 0;
      var prevRepetitions = typeof prev.repetitions === 'number' ? prev.repetitions : 0;

      // SuperMemo-2 easiness factor update:
      // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
      var missDistance = 5 - q;
      var easinessFactor = prevEF + (0.1 - missDistance * (0.08 + missDistance * 0.02));
      easinessFactor = Math.max(this.minEF, easinessFactor);

      var repetitions;
      var interval;

      if (q < 3) {
        repetitions = 0;
        interval = 0;
      } else {
        repetitions = prevRepetitions + 1;

        if (repetitions === 1) {
          interval = 1;
        } else if (repetitions === 2) {
          interval = 6;
        } else {
          interval = Math.round(prevInterval * easinessFactor);
        }
      }

      var today = todayString();

      return {
        easinessFactor: easinessFactor,
        interval: interval,
        repetitions: repetitions,
        nextReview: addDays(today, interval),
        lastReview: today,
        lastQuality: q
      };
    }
  };

  // ===== STORAGE =====
  window.CJ.DB = {
    load: function () {
      var fallback = normalizeData(null);

      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return fallback;

        return normalizeData(JSON.parse(raw));
      } catch (error) {
        console.warn('Coding Journal: failed to load localStorage data.', error);
        return fallback;
      }
    },

    save: function (data) {
      var normalized = normalizeData(data);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    },

    getAll: function () {
      return this.load().cards;
    },

    getDue: function () {
      var today = todayString();
      return this.getAll().filter(function (card) {
        return card && card.sm2 && card.sm2.nextReview <= today;
      });
    },

    getMastered: function () {
      return this.getAll().filter(function (card) {
        return card && card.sm2 && card.sm2.repetitions >= 5;
      });
    },

    add: function (card) {
      var data = this.load();
      var now = isoNow();
      var newCard = Object.assign({}, card || {}, {
        id: uniqueId(),
        created: now,
        updated: now,
        sm2: window.CJ.SM2.newCard()
      });

      if (!Array.isArray(newCard.tags)) newCard.tags = [];

      data.cards.push(newCard);
      this.save(data);

      return newCard;
    },

    update: function (id, updates) {
      var data = this.load();
      var card = data.cards.find(function (item) {
        return item && item.id === id;
      });

      if (!card) return null;

      Object.assign(card, updates || {}, { updated: isoNow() });
      this.save(data);

      return card;
    },

    delete: function (id) {
      var data = this.load();
      var beforeCount = data.cards.length;

      data.cards = data.cards.filter(function (card) {
        return !card || card.id !== id;
      });

      if (data.cards.length === beforeCount) return false;

      this.save(data);
      return true;
    },

    review: function (id, quality) {
      var data = this.load();
      var card = data.cards.find(function (item) {
        return item && item.id === id;
      });

      if (!card) return null;

      card.sm2 = window.CJ.SM2.calc(quality, card.sm2);
      card.updated = isoNow();
      this.save(data);

      return card;
    },

    getStreak: function () {
      var reviewedDates = new Set();

      this.getAll().forEach(function (card) {
        if (card && card.sm2 && card.sm2.lastReview) {
          reviewedDates.add(card.sm2.lastReview);
        }
      });

      var cursor = todayString();

      // If no review happened today, count the streak ending yesterday.
      if (!reviewedDates.has(cursor)) {
        cursor = addDays(cursor, -1);
      }

      var streak = 0;
      while (reviewedDates.has(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
      }

      return streak;
    }
  };
})();
