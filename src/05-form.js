(function () {
  'use strict';

  window.CJ = window.CJ || {};

  var CJ = window.CJ;

  function byId(id) {
    return document.getElementById(id);
  }

  function valueOf(id) {
    var element = byId(id);
    return element ? element.value : '';
  }

  function setValue(id, value) {
    var element = byId(id);
    if (element) element.value = value === null || value === undefined ? '' : value;
  }

  function showToast(message) {
    if (CJ.renderer && typeof CJ.renderer.showToast === 'function') {
      CJ.renderer.showToast(message);
      return;
    }

    if (typeof window.alert === 'function') {
      window.alert(message);
    }
  }

  function showErrors(errors) {
    var errorBox = byId('formErrors');
    if (!errorBox) return;

    if (!errors || !errors.length) {
      errorBox.innerHTML = '';
      errorBox.classList.add('hidden');
      return;
    }

    errorBox.innerHTML = '<ul style="margin:0; padding-left:20px;">' + errors.map(function (error) {
      return '<li>' + String(error)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;') + '</li>';
    }).join('') + '</ul>';
    errorBox.classList.remove('hidden');
  }

  CJ.form = {
    editCardId: null,

    renderAddForm: function (cardToEdit) {
      var content = byId('content');
      if (!content) return;

      var isEdit = !!cardToEdit;
      this.editCardId = isEdit && cardToEdit.id ? cardToEdit.id : null;

      content.innerHTML = '' +
        '<h2 style="margin-top:0;">' + (isEdit ? 'Edit Question' : 'Add New Question') + '</h2>' +
        '<form id="questionForm" onsubmit="return CJ.form.handleSubmit(event)">' +
          '<div class="form-row">' +
            '<div class="form-group">' +
              '<label for="formQuestion">Question *</label>' +
              '<input type="text" id="formQuestion" placeholder="e.g. Two Sum" required>' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="formLink">Link</label>' +
              '<input type="url" id="formLink" placeholder="https://leetcode.com/...">' +
            '</div>' +
          '</div>' +

          '<div class="form-row">' +
            '<div class="form-group">' +
              '<label for="formTags">Tags (comma-separated)</label>' +
              '<input type="text" id="formTags" placeholder="arrays, hash-map">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="formDifficulty">Difficulty</label>' +
              '<select id="formDifficulty">' +
                '<option value="easy">Easy</option>' +
                '<option value="medium" selected>Medium</option>' +
                '<option value="hard">Hard</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="form-group">' +
            '<label for="formMyThinking">What I Was Thinking *</label>' +
            '<textarea id="formMyThinking" rows="4" placeholder="Describe your initial approach. What went wrong?"></textarea>' +
          '</div>' +

          '<div class="form-group">' +
            '<label for="formRightThinking">What the Right Thinking Is *</label>' +
            '<textarea id="formRightThinking" rows="4" placeholder="Describe the correct approach and mental model."></textarea>' +
          '</div>' +

          '<div class="form-group">' +
            '<label for="formActualCode">Actual Code</label>' +
            '<textarea id="formActualCode" rows="6" placeholder="Paste your solution code here..."></textarea>' +
          '</div>' +

          '<div class="form-group">' +
            '<label for="formNotes">Notes (optional)</label>' +
            '<textarea id="formNotes" rows="2" placeholder="Additional observations, edge cases, alternative solutions..."></textarea>' +
          '</div>' +

          '<div id="formErrors" class="hidden" style="color:var(--red); margin-bottom:12px; font-size:14px;"></div>' +

          '<button type="submit" class="btn-primary" id="formSubmit">' + (isEdit ? 'Update Question' : 'Save Question') + '</button>' +
        '</form>';

      showErrors([]);

      if (isEdit) {
        this.populateForm(cardToEdit);
      }
    },

    getFormData: function () {
      var tags = valueOf('formTags').split(',').map(function (tag) {
        return tag.trim();
      }).filter(function (tag) {
        return tag.length > 0;
      });

      return {
        question: valueOf('formQuestion').trim(),
        link: valueOf('formLink').trim(),
        tags: tags,
        difficulty: valueOf('formDifficulty') || 'medium',
        actual_code: valueOf('formActualCode'),
        my_thinking: valueOf('formMyThinking').trim(),
        right_thinking: valueOf('formRightThinking').trim(),
        notes: valueOf('formNotes')
      };
    },

    validate: function (data) {
      var errors = [];
      data = data || {};

      if (!data.question || !data.question.trim()) {
        errors.push('Question is required.');
      }

      if (!data.my_thinking || !data.my_thinking.trim()) {
        errors.push('What I Was Thinking is required.');
      }

      if (!data.right_thinking || !data.right_thinking.trim()) {
        errors.push('What the Right Thinking Is is required.');
      }

      return {
        valid: errors.length === 0,
        errors: errors
      };
    },

    handleSubmit: function (e) {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }

      var data = this.getFormData();
      var result = this.validate(data);

      if (!result.valid) {
        showErrors(result.errors);
        return false;
      }

      showErrors([]);

      if (!CJ.DB) {
        showErrors(['Storage is not available. Try refreshing the page.']);
        return false;
      }

      if (this.editCardId) {
        CJ.DB.update(this.editCardId, data);
        this.clearForm();
        showToast('Updated!');
      } else {
        CJ.DB.add(data);
        this.clearForm();
        showToast('Saved!');
      }

      if (CJ.renderer) {
        if (typeof CJ.renderer.switchTab === 'function') {
          CJ.renderer.switchTab('all');
        }
        if (typeof CJ.renderer.refresh === 'function') {
          CJ.renderer.refresh();
        }
      }

      return false;
    },

    clearForm: function () {
      var form = byId('questionForm');
      if (form && typeof form.reset === 'function') {
        form.reset();
      }

      setValue('formQuestion', '');
      setValue('formLink', '');
      setValue('formTags', '');
      setValue('formDifficulty', 'medium');
      setValue('formActualCode', '');
      setValue('formMyThinking', '');
      setValue('formRightThinking', '');
      setValue('formNotes', '');
      showErrors([]);

      this.editCardId = null;
    },

    populateForm: function (card) {
      card = card || {};

      setValue('formQuestion', card.question || card.title || '');
      setValue('formLink', card.link || '');
      setValue('formTags', Array.isArray(card.tags) ? card.tags.join(', ') : (card.tags || ''));
      setValue('formDifficulty', card.difficulty || 'medium');
      setValue('formActualCode', card.actual_code || card.code || '');
      setValue('formMyThinking', card.my_thinking || '');
      setValue('formRightThinking', card.right_thinking || '');
      setValue('formNotes', card.notes || '');

      this.editCardId = card.id || null;
    }
  };
})();
