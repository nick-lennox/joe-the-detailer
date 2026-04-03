// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const navLinks = document.getElementById('nav-links');

toggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  toggle.classList.toggle('active');
  toggle.setAttribute('aria-expanded', open);
});

// Close nav when a link is clicked
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  });
});

// Scroll-triggered fade-in animations
const animTargets = document.querySelectorAll(
  '.section-title, .section-sub, .card, .step, .gallery-item, .about-content, .addons, .estimator-box'
);

animTargets.forEach(el => el.classList.add('fade-in'));

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

animTargets.forEach(el => observer.observe(el));

// Sticky nav background on scroll
const nav = document.getElementById('nav');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > 50) {
    nav.style.background = 'rgba(10, 10, 15, 0.95)';
  } else {
    nav.style.background = 'rgba(10, 10, 15, 0.85)';
  }
  lastScroll = y;
}, { passive: true });

// =============================================
// Price Estimator (NHTSA API + local tier map)
// =============================================
(() => {
  const makeInput = document.getElementById('make-input');
  const modelInput = document.getElementById('model-input');
  const makeDropdown = document.getElementById('make-dropdown');
  const modelDropdown = document.getElementById('model-dropdown');
  const makeSpinner = document.getElementById('make-spinner');
  const modelSpinner = document.getElementById('model-spinner');
  const resetBtn = document.getElementById('estimator-reset');
  const fallback = document.getElementById('tier-fallback');
  const resultEl = document.getElementById('estimator-result');
  const tierReveal = document.getElementById('tier-reveal');
  const priceCard = document.getElementById('price-card');
  const priceCardHeader = document.getElementById('price-card-header');

  if (!makeInput) return;

  const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Curated list of consumer car brands
  const KNOWN_MAKES = new Set([
    'acura', 'alfa romeo', 'aston martin', 'audi', 'bentley', 'bmw', 'buick',
    'cadillac', 'chevrolet', 'chrysler', 'dodge', 'ferrari', 'fiat', 'ford',
    'genesis', 'gmc', 'honda', 'hyundai', 'infiniti', 'jaguar', 'jeep', 'kia',
    'lamborghini', 'land rover', 'lexus', 'lincoln', 'lucid', 'maserati',
    'mazda', 'mclaren', 'mercedes-benz', 'mini', 'mitsubishi', 'nissan',
    'polestar', 'porsche', 'ram', 'rivian', 'rolls-royce', 'saab', 'subaru', 'suzuki',
    'tesla', 'toyota', 'volkswagen', 'volvo',
  ]);

  // Map NHTSA vehicle types to our default pricing tiers
  const NHTSA_TYPE_DEFAULTS = {
    'Passenger Car': 'midsize',
    'Truck': 'fullsize',
    'Multipurpose Passenger Vehicle (MPV)': 'suv',
    'Van': 'oversized',
  };

  let allMakes = [];
  let currentModels = [];  // [{name, nhtsaType}]
  let selectedMake = null;
  let selectedModel = null;
  let hasConfettied = false;
  let makeDebounce, modelDebounce;

  // --- Helpers ---
  function formatPrice(cents, prefix) {
    prefix = prefix || '';
    const dollars = Math.floor(cents / 100);
    const remainder = cents % 100;
    if (remainder === 0) return prefix + '$' + dollars;
    return prefix + '$' + dollars + '.' + String(remainder).padStart(2, '0');
  }

  function renderDropdown(dropdown, items, onSelect) {
    if (items.length === 0) {
      dropdown.hidden = true;
      return;
    }
    dropdown.innerHTML = items.map((item, i) =>
      '<div class="autocomplete-item" data-index="' + i + '">' +
        '<span class="autocomplete-item-name">' + item.label + '</span>' +
        (item.badge ? '<span class="autocomplete-item-tier">' + item.badge + '</span>' : '') +
      '</div>'
    ).join('');
    dropdown.hidden = false;
    dropdown.querySelectorAll('.autocomplete-item').forEach(el => {
      el.addEventListener('click', () => onSelect(items[parseInt(el.dataset.index)]));
    });
  }

  function setupKeyboard(input, dropdown, getItems, onSelect) {
    let activeIdx = -1;
    input.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.autocomplete-item');
      if (dropdown.hidden || items.length === 0) {
        if (e.key === 'Escape') dropdown.hidden = true;
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach((it, i) => it.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach((it, i) => it.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0) {
          const all = getItems();
          if (all[activeIdx]) onSelect(all[activeIdx]);
        }
      } else if (e.key === 'Escape') {
        dropdown.hidden = true;
      } else {
        activeIdx = -1;
      }
    });
  }

  // --- Fetch makes on load ---
  async function loadMakes() {
    makeSpinner.hidden = false;
    try {
      const res = await fetch(NHTSA_BASE + '/getallmakes?format=json');
      const data = await res.json();
      allMakes = data.Results
        .filter(m => KNOWN_MAKES.has(m.Make_Name.toLowerCase()))
        .map(m => ({ id: m.Make_ID, name: m.Make_Name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      // Fallback: populate from tier map keys
      const makeSet = new Set();
      Object.keys(TIER_MAP).forEach(key => {
        const make = key.split(' ')[0];
        makeSet.add(make.charAt(0).toUpperCase() + make.slice(1));
      });
      allMakes = Array.from(makeSet).sort().map(name => ({ id: 0, name }));
    }
    makeSpinner.hidden = true;
  }

  function filterMakes(query) {
    const q = query.toLowerCase().trim();
    if (q.length < 1) return allMakes.slice(0, 12).map(m => ({ label: m.name, value: m }));
    return allMakes
      .filter(m => m.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map(m => ({ label: m.name, value: m }));
  }

  let filteredMakes = [];
  makeInput.addEventListener('input', () => {
    // If they're retyping after a selection, reset everything downstream
    if (selectedMake) {
      selectedMake = null;
      makeInput.classList.remove('has-value');
      selectedModel = null;
      modelInput.value = '';
      modelInput.classList.remove('has-value');
      modelInput.disabled = true;
      modelInput.placeholder = 'Select a make first...';
      currentModels = [];
      fallback.hidden = true;
      resultEl.hidden = true;
      tierReveal.classList.remove('show');
      priceCard.classList.remove('show');
      priceCard.querySelectorAll('.price-row').forEach(r => r.classList.remove('show'));
      hasConfettied = false;
    }
    clearTimeout(makeDebounce);
    makeDebounce = setTimeout(() => {
      filteredMakes = filterMakes(makeInput.value);
      renderDropdown(makeDropdown, filteredMakes, selectMake);
    }, 100);
  });

  makeInput.addEventListener('focus', () => {
    if (selectedMake) {
      makeInput.select();
    }
    if (allMakes.length > 0) {
      filteredMakes = filterMakes(makeInput.value);
      renderDropdown(makeDropdown, filteredMakes, selectMake);
    }
  });

  setupKeyboard(makeInput, makeDropdown, () => filteredMakes, selectMake);

  // --- Select make -> fetch models ---
  async function selectMake(item) {
    selectedMake = item.value;
    makeInput.value = selectedMake.name;
    makeInput.classList.add('has-value');
    makeDropdown.hidden = true;
    resetBtn.hidden = false;

    // Reset model
    selectedModel = null;
    modelInput.value = '';
    modelInput.classList.remove('has-value');
    modelInput.disabled = false;
    modelInput.placeholder = 'Loading models...';
    fallback.hidden = true;
    resultEl.hidden = true;
    tierReveal.classList.remove('show');
    priceCard.classList.remove('show');
    priceCard.querySelectorAll('.price-row').forEach(r => r.classList.remove('show'));

    // Fetch models from 3 vehicle type endpoints in parallel
    modelSpinner.hidden = false;
    try {
      const makeId = selectedMake.id;
      const year = new Date().getFullYear();
      const types = ['car', 'truck', 'mpv'];
      const fetches = types.map(t =>
        fetch(NHTSA_BASE + '/GetModelsForMakeIdYear/makeId/' + makeId + '/modelyear/' + year + '/vehicletype/' + t + '?format=json')
          .then(r => r.json())
          .catch(() => ({ Results: [] }))
      );
      const results = await Promise.all(fetches);
      const seen = new Set();
      currentModels = [];
      results.forEach(data => {
        (data.Results || []).forEach(m => {
          if (!seen.has(m.Model_Name)) {
            seen.add(m.Model_Name);
            currentModels.push({
              name: m.Model_Name,
              nhtsaType: m.VehicleTypeName || '',
            });
          }
        });
      });
      currentModels.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      // Fallback from tier map
      const prefix = selectedMake.name.toLowerCase() + ' ';
      currentModels = Object.keys(TIER_MAP)
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length))
        .map(m => ({
          name: m.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          nhtsaType: '',
        }));
    }
    modelSpinner.hidden = true;
    modelInput.placeholder = 'Search model...';
    modelInput.focus();
  }

  function getTierForModel(model) {
    const key = (selectedMake.name + ' ' + model.name).toLowerCase();
    // 1. Check local tier map first (most accurate)
    if (TIER_MAP[key]) return TIER_MAP[key];
    // 2. Fall back to NHTSA vehicle type
    if (model.nhtsaType && NHTSA_TYPE_DEFAULTS[model.nhtsaType]) {
      return NHTSA_TYPE_DEFAULTS[model.nhtsaType];
    }
    return null;
  }

  function tierBadge(model) {
    const tier = getTierForModel(model);
    return tier ? PRICING[tier].label : '';
  }

  function filterModels(query) {
    const q = query.toLowerCase().trim();
    if (q.length < 1) return currentModels.slice(0, 12).map(m => ({
      label: m.name, value: m, badge: tierBadge(m),
    }));
    return currentModels
      .filter(m => m.name.toLowerCase().includes(q))
      .slice(0, 10)
      .map(m => ({
        label: m.name, value: m, badge: tierBadge(m),
      }));
  }

  let filteredModels = [];
  modelInput.addEventListener('input', () => {
    // If retyping after a selection, clear result
    if (selectedModel) {
      selectedModel = null;
      modelInput.classList.remove('has-value');
      fallback.hidden = true;
      resultEl.hidden = true;
      tierReveal.classList.remove('show');
      priceCard.classList.remove('show');
      priceCard.querySelectorAll('.price-row').forEach(r => r.classList.remove('show'));
      hasConfettied = false;
    }
    clearTimeout(modelDebounce);
    modelDebounce = setTimeout(() => {
      filteredModels = filterModels(modelInput.value);
      renderDropdown(modelDropdown, filteredModels, selectModel);
    }, 100);
  });

  modelInput.addEventListener('focus', () => {
    if (selectedModel) {
      modelInput.select();
    }
    if (currentModels.length > 0) {
      filteredModels = filterModels(modelInput.value);
      renderDropdown(modelDropdown, filteredModels, selectModel);
    }
  });

  setupKeyboard(modelInput, modelDropdown, () => filteredModels, selectModel);

  // --- Select model -> show pricing ---
  function selectModel(item) {
    selectedModel = item.value;
    modelInput.value = selectedModel.name;
    modelInput.classList.add('has-value');
    modelDropdown.hidden = true;

    const vehicleName = selectedMake.name + ' ' + selectedModel.name;
    const tier = getTierForModel(selectedModel);

    if (tier) {
      fallback.hidden = true;
      showResult(tier, vehicleName);
    } else {
      // Unknown tier — ask user
      fallback.hidden = false;
      fallback._vehicleName = vehicleName;
    }
  }

  // --- Tier fallback buttons ---
  document.querySelectorAll('.tier-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
      const vehicleName = fallback._vehicleName || 'Your Vehicle';
      fallback.hidden = true;
      showResult(btn.dataset.tier, vehicleName);
    });
  });

  // --- Show result with animations ---
  function showResult(tier, vehicleName) {
    const tierData = PRICING[tier];
    resultEl.hidden = false;

    tierReveal.innerHTML =
      '<span class="tier-icon">' + tierData.icon + '</span>' +
      '<span class="tier-text">Your <strong>' + vehicleName + '</strong> is classified as ' +
      '<span class="tier-label">' + tierData.label + '</span></span>';

    requestAnimationFrame(() => tierReveal.classList.add('show'));

    priceCardHeader.textContent = 'Pricing for ' + tierData.label + ' Vehicles';
    requestAnimationFrame(() => priceCard.classList.add('show'));

    const rows = priceCard.querySelectorAll('.price-row');
    const services = {
      exterior: { cents: tierData.exterior, prefix: '' },
      interior: { cents: tierData.interior, prefix: '' },
      combo: { cents: tierData.combo, prefix: '' },
      shampoo: { cents: tierData.shampoo, prefix: '+' },
      claybar: { cents: tierData.claybar, prefix: '+' },
      polish: { cents: tierData.polish, prefix: '+' },
      engine: { cents: tierData.engine, prefix: '+' },
      deepclean: { cents: tierData.deepclean, prefix: '+' },
    };

    rows.forEach((row, i) => {
      const service = row.dataset.service;
      const data = services[service];
      if (!data) return;

      const priceEl = row.querySelector('.price-value');
      const delay = prefersReducedMotion ? 0 : i * 100;

      setTimeout(() => {
        row.classList.add('show');

        if (prefersReducedMotion || typeof anime === 'undefined') {
          priceEl.textContent = formatPrice(data.cents, data.prefix);
        } else {
          const obj = { val: 0 };
          anime({
            targets: obj,
            val: data.cents,
            round: 1,
            duration: 600,
            easing: 'easeOutExpo',
            update: () => {
              priceEl.textContent = formatPrice(Math.round(obj.val), data.prefix);
            }
          });
        }
      }, delay + 200);
    });

    if (!hasConfettied && !prefersReducedMotion && typeof confetti === 'function') {
      const totalDelay = rows.length * 100 + 800;
      setTimeout(() => {
        confetti({
          particleCount: 70,
          spread: 80,
          origin: { y: 0.7 },
          colors: ['#006eff', '#ffffff', '#4d9fff', '#0044aa'],
        });
        hasConfettied = true;
      }, totalDelay);
    }
  }

  // --- Reset ---
  function resetEstimator() {
    selectedMake = null;
    selectedModel = null;
    makeInput.value = '';
    makeInput.classList.remove('has-value');
    modelInput.value = '';
    modelInput.classList.remove('has-value');
    modelInput.disabled = true;
    modelInput.placeholder = 'Select a make first...';
    makeDropdown.hidden = true;
    modelDropdown.hidden = true;
    fallback.hidden = true;
    resultEl.hidden = true;
    tierReveal.classList.remove('show');
    priceCard.classList.remove('show');
    priceCard.querySelectorAll('.price-row').forEach(r => r.classList.remove('show'));
    resetBtn.hidden = true;
    hasConfettied = false;
    currentModels = [];
    makeInput.focus();
  }

  resetBtn.addEventListener('click', resetEstimator);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#make-wrap')) makeDropdown.hidden = true;
    if (!e.target.closest('#model-wrap')) modelDropdown.hidden = true;
  });

  // Init: load makes
  loadMakes();
})();
