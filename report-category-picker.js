function optionLabel(option) {
  return option.getAttribute('aria-label') || option.textContent.trim();
}

function setInvalid(element, invalid) {
  if (invalid) element.setAttribute('aria-invalid', 'true');
  else element.removeAttribute('aria-invalid');
}

export function initializeReportCategoryPicker(select, createSign) {
  const picker = document.createElement('details');
  const options = Array.from(select.options).filter(option => !option.disabled);
  if (!('open' in picker) || options.length === 0) {
    return {
      focus: () => select.focus(),
      setInvalid: invalid => setInvalid(select, invalid),
      sync() {},
    };
  }

  picker.className = 'report-category-picker';
  const trigger = document.createElement('summary');
  trigger.className = 'report-category-picker-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  const triggerText = document.createElement('span');
  triggerText.id = `${select.id}-picker-value`;

  const list = document.createElement('div');
  list.className = 'report-category-picker-list';
  list.id = `${select.id}-picker-options`;
  list.setAttribute('role', 'listbox');
  trigger.setAttribute('aria-controls', list.id);
  if (select.required) list.setAttribute('aria-required', 'true');

  const label = select.labels?.[0];
  if (label) {
    if (!label.id) label.id = `${select.id}-picker-label`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${triggerText.id}`);
    list.setAttribute('aria-labelledby', label.id);
    label.addEventListener('click', event => {
      event.preventDefault();
      trigger.focus();
    });
  } else {
    list.setAttribute('aria-label', select.getAttribute('aria-label') || 'Categoría');
  }

  const rows = options.map(option => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'report-category-picker-option';
    row.setAttribute('role', 'option');
    if (option.value) row.append(createSign(option.value));
    row.append(optionLabel(option));
    row.addEventListener('click', () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      picker.open = false;
      trigger.focus();
    });
    list.append(row);
    return row;
  });

  function setTabStop(index) {
    rows.forEach((row, i) => { row.tabIndex = i === index ? 0 : -1; });
  }

  function sync() {
    const selected = select.selectedOptions[0];
    let active = options.indexOf(selected);
    if (active === -1) active = 0;
    setTabStop(active);
    rows.forEach((row, i) => row.setAttribute('aria-selected', String(options[i] === selected)));

    trigger.replaceChildren(triggerText);
    triggerText.textContent = selected ? optionLabel(selected) : 'Elegí una categoría';
    if (selected?.value) trigger.prepend(createSign(selected.value));
  }

  function focusRow(index) {
    setTabStop(index);
    rows[index].focus();
  }

  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && picker.open) {
      event.preventDefault();
      event.stopPropagation();
      picker.open = false;
      trigger.focus();
      return;
    }

    const current = rows.indexOf(document.activeElement);
    let next;
    switch (event.key) {
      case 'ArrowDown':
        next = current === -1 ? rows.findIndex(row => row.tabIndex === 0) : Math.min(current + 1, rows.length - 1);
        break;
      case 'ArrowUp':
        next = current === -1 ? rows.length - 1 : Math.max(current - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = rows.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    picker.open = true;
    focusRow(next);
  });

  document.addEventListener('click', event => {
    if (picker.open && !picker.contains(event.target)) picker.open = false;
  });
  select.addEventListener('change', sync);
  select.form?.addEventListener('reset', () => queueMicrotask(sync));
  picker.append(trigger, list);
  sync();
  select.after(picker);
  select.hidden = true;

  return {
    focus: () => trigger.focus(),
    setInvalid: invalid => setInvalid(trigger, invalid),
    sync,
  };
}
