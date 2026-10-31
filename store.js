
(() => {
  'use strict';

  const cfg = window.STORE_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const grid = $('#product-grid');
  const modal = $('#product-modal');
  const form = $('#order-form');

  if (!grid || !modal || !form) {
    console.error('SADEE PRO STORE: Required HTML elements are missing.');
    return;
  }

  const setText = (selector, value) => {
    const el = $(selector);
    if (el) el.textContent = value;
  };

  const safeStorage = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.warn('Storage unavailable:', error);
      }
    }
  };

  let client = null;
  let products = [];
  let selected = null;
  let category = 'All';
  let validatedPromo = '';
  let validatedDiscount = 0;
  let reviewRequestId = 0;

  let wishlist = new Set();

  try {
    const saved = JSON.parse(safeStorage.get('sadee_wishlist', '[]'));
    if (Array.isArray(saved)) wishlist = new Set(saved.map(String));
  } catch {
    wishlist = new Set();
  }

  let lang = safeStorage.get('sadee_lang', 'en');

  setText(
    '#ezcash-number',
    cfg.EZCASH_NUMBER || 'Store owner must configure the official eZ Cash number'
  );

  setText('#year', new Date().getFullYear());

  const money = amount => {
    const number = Number(amount || 0);
    return `${cfg.CURRENCY || 'LKR'} ${number.toLocaleString('en-LK')}`;
  };

  const esc = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);

  const ready =
    Boolean(cfg.SUPABASE_URL) &&
    Boolean(cfg.SUPABASE_ANON_KEY) &&
    !String(cfg.SUPABASE_URL).includes('YOUR_PROJECT') &&
    !String(cfg.SUPABASE_ANON_KEY).includes('YOUR_');

  if (ready && window.supabase?.createClient) {
    try {
      client = window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      );
    } catch (error) {
      console.error('Supabase initialization failed:', error);
    }
  }

  const fallbackPlans = [
    { name: 'Lifetime', duration: 'Lifetime access', price: 4500 },
    { name: '1 Month', duration: '30 days', price: 2200 },
    { name: '7 Days', duration: '7 days', price: 1000 },
    { name: '1 Day Trial', duration: '24 hours', price: 300 },
    { name: '3 Days', duration: '3 days', price: 600 },
    { name: '15 Days', duration: '15 days', price: 1500 },
    { name: '3 Months', duration: '90 days', price: 3500 },
    { name: '6 Months', duration: '180 days', price: 4000 }
  ];

  function parsePlans(product) {
    try {
      const plans = Array.isArray(product.plans)
        ? product.plans
        : JSON.parse(product.plans || '[]');

      const valid = plans.filter(plan =>
        plan &&
        String(plan.name || '').trim() &&
        Number.isFinite(Number(plan.price)) &&
        Number(plan.price) >= 0
      );

      return valid.length ? valid : fallbackPlans;
    } catch {
      return fallbackPlans;
    }
  }

  function getProductPrice(product) {
    const prices = parsePlans(product).map(plan => Number(plan.price) || 0);
    return Math.min(...prices);
  }

  function render() {
    const search = $('#search');
    const query = (search?.value || '').trim().toLowerCase();

    const list = products.filter(product => {
      const matchesCategory =
        category === 'All' || product.category === category;

      const searchableText = [
        product.name,
        product.description,
        product.category
      ].join(' ').toLowerCase();

      return matchesCategory && searchableText.includes(query);
    });

    grid.innerHTML = list.length
      ? list.map(product => {
          const id = esc(product.id);
          const saved = wishlist.has(String(product.id));
          const plans = parsePlans(product);
          const lowestPrice = Math.min(
            ...plans.map(plan => Number(plan.price) || 0)
          );

          const stock = Number(product.stock || 0);

          return `
            <article class="product-card ${product.featured ? 'featured-card' : ''}">
              <button
                type="button"
                class="product-heart ${saved ? 'saved' : ''}"
                data-wish="${id}"
                aria-label="Toggle wishlist"
                aria-pressed="${saved}"
              >${saved ? '♥' : '♡'}</button>

              <button
                type="button"
                class="product-open"
                data-detail="${id}"
                aria-label="View ${esc(product.name)} details"
              >
                <div class="product-image">
                  ${
                    product.image_url
                      ? `<img
                          src="${esc(product.image_url)}"
                          alt="${esc(product.name)}"
                          loading="lazy"
                          onerror="this.remove()"
                        >`
                      : '<span class="product-placeholder">SP<span style="font-size:15px">+</span></span>'
                  }

                  <span class="product-tag">
                    ${esc(product.category || 'Digital')}
                  </span>

                  ${
                    product.featured
                      ? '<span class="featured-tag">FEATURED</span>'
                      : ''
                  }
                </div>

                <div class="product-info">
                  <span class="product-category">
                    ${esc(product.category || 'Digital product')}
                  </span>

                  <h3>${esc(product.name)}</h3>

                  <p class="product-description">
                    ${esc(product.description || 'A digital product from SADEE PRO STORE.')}
                  </p>

                  <div class="product-bottom">
                    <span class="stock-pill ${stock <= 3 ? 'low' : ''}">
                      ${stock > 0 ? `${stock} available` : 'Contact for availability'}
                    </span>

                    <span class="price">From ${money(lowestPrice)}</span>
                    <span class="order-btn">View details ↗</span>
                  </div>
                </div>
              </button>
            </article>
          `;
        }).join('')
      : `
        <div class="empty-state">
          ${
            ready
              ? 'No products found. Check back soon.'
              : 'Connect Supabase to publish products. See README.md for setup.'
          }
        </div>
      `;

    $$('[data-detail]', grid).forEach(button => {
      button.addEventListener('click', () => {
        openProduct(button.dataset.detail);
      });
    });

    $$('[data-wish]', grid).forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleWish(button.dataset.wish);
      });
    });

    renderWishlist();
  }

  function toggleWish(id) {
    id = String(id);

    if (wishlist.has(id)) {
      wishlist.delete(id);
    } else {
      wishlist.add(id);
    }

    safeStorage.set('sadee_wishlist', JSON.stringify([...wishlist]));
    render();
  }

  function renderWishlist() {
    const host = $('#wishlist-grid');
    if (!host) return;

    const list = products.filter(product =>
      wishlist.has(String(product.id))
    );

    host.innerHTML = list.length
      ? list.map(product => `
          <article class="product-card">
            <button
              type="button"
              class="product-open"
              data-detail="${esc(product.id)}"
            >
              <div class="product-image">
                ${
                  product.image_url
                    ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">`
                    : '<span class="product-placeholder">SP+</span>'
                }
              </div>

              <div class="product-info">
                <h3>${esc(product.name)}</h3>
                <div class="product-bottom">
                  <span class="price">
                    From ${money(getProductPrice(product))}
                  </span>
                  <span class="order-btn">View ↗</span>
                </div>
              </div>
            </button>

            <button
              type="button"
              class="btn btn-outline full"
              data-remove-wish="${esc(product.id)}"
            >Remove from wishlist</button>
          </article>
        `).join('')
      : `
        <div class="empty-state">
          No saved products yet. Tap ♡ on a product to add it.
        </div>
      `;

    $$('[data-detail]', host).forEach(button => {
      button.addEventListener('click', () => {
        openProduct(button.dataset.detail);
      });
    });

    $$('[data-remove-wish]', host).forEach(button => {
      button.addEventListener('click', () => {
        toggleWish(button.dataset.removeWish);
      });
    });
  }

  async function loadAnnouncements() {
    const host = $('#announcement-list');
    if (!host) return;

    if (!client) {
      host.innerHTML = '<div class="empty-state">Store updates will appear here.</div>';
      return;
    }

    try {
      const { data, error } = await client
        .from('store_announcements')
        .select('title,body,kind,created_at')
        .eq('published', true)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;

      if (!data?.length) {
        host.innerHTML = '<div class="empty-state">No announcements right now.</div>';
        return;
      }

      host.innerHTML = data.map(item => `
        <article class="announcement-card">
          <small>${esc(item.kind || 'update')}</small>
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.body)}</p>
        </article>
      `).join('');
    } catch (error) {
      console.error('Announcement loading failed:', error);
      host.innerHTML = '<div class="empty-state">Announcements could not be loaded.</div>';
    }
  }

  function updateLanguage() {
    const toggle = $('#language-toggle');
    const heading = $('.hero h1');
    const subtitle = $('.hero-sub');

    if (toggle) {
      toggle.textContent = lang === 'en' ? 'සිං / EN' : 'EN / සිං';
    }

    document.documentElement.lang = lang;

    if (heading) {
      heading.innerHTML = lang === 'si'
        ? 'ඔබේ මට්ටම.<br><span>ඊළඟට ගෙනයන්න.</span>'
        : 'ENTER THE NEXT LEVEL.<br><span>UNLOCK YOUR EDGE.</span>';
    }

    if (subtitle) {
      subtitle.textContent = lang === 'si'
        ? 'ඔබගේ ඊළඟ මට්ටමට ගැළපෙන gaming products සහ digital tools තෝරන්න.'
        : 'Premium gaming tools, digital upgrades and creator essentials. Choose your edge, place your order, and track every unlock in one place.';
    }
  }

  $('#language-toggle')?.addEventListener('click', () => {
    lang = lang === 'en' ? 'si' : 'en';
    safeStorage.set('sadee_lang', lang);
    updateLanguage();
  });

  async function loadHero() {
    if (!client) return;

    try {
      const { data, error } = await client
        .from('site_settings')
        .select('key,value')
        .in('key', [
          'hero_video_url',
          'hero_image_url',
          'accent_color',
          'logo_image_url'
        ]);

      if (error) throw error;

      const settings = Object.fromEntries(
        (data || []).map(item => [item.key, item.value])
      );

      if (settings.logo_image_url) {
        $$('.brand-mark').forEach(element => {
          element.innerHTML = `
            <img
              src="${esc(settings.logo_image_url)}"
              alt="SADEE logo"
              style="width:100%;height:100%;object-fit:contain"
            >
          `;
        });
      }

      if (settings.hero_image_url) {
        const image = $('.hero-photo');
        if (image) image.src = settings.hero_image_url;
      }

      if (
        settings.accent_color &&
        /^#[0-9a-f]{6}$/i.test(settings.accent_color)
      ) {
        document.documentElement.style.setProperty(
          '--red',
          settings.accent_color
        );
      }

      if (settings.hero_video_url) {
        const video = $('#hero-video');

        if (video) {
          video.src = settings.hero_video_url;
          video.hidden = false;
          video.muted = true;
          video.playsInline = true;

          video.play().catch(() => {
            // Autoplay may be blocked by the browser.
          });

          const chip = $('#hero-chip');
          if (chip) chip.hidden = true;
        }
      }
    } catch (error) {
      console.error('Hero settings could not be loaded:', error);
    }
  }

  async function load() {
    await loadAnnouncements();

    if (!client) {
      products = [];
      render();
      return;
    }

    try {
      const { data, error } = await client
        .from('products')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      products = data || [];
      render();

      await loadHero();
    } catch (error) {
      console.error('Product loading failed:', error);
      grid.innerHTML = `
        <div class="empty-state">
          Could not load products. Check the Supabase setup and SQL policies.
        </div>
      `;
    }
  }

  function updatePlan() {
    if (!selected) return;

    const planSelect = $('#plan-select');
    const selectedProduct = $('#selected-product');

    if (!planSelect || !selectedProduct) return;

    const plans = parsePlans(selected);
    const index = Number(planSelect.value) || 0;
    const plan = plans[index] || plans[0];

    if (!plan) return;

    const promoInput = form.elements.namedItem('promo_code');
    const enteredPromo = String(promoInput?.value || '')
      .trim()
      .toUpperCase();

    const discount =
      validatedPromo && validatedPromo === enteredPromo
        ? validatedDiscount
        : 0;

    const originalPrice = Number(plan.price) || 0;
    const amount = Math.max(
      0,
      Math.round(
        (originalPrice - originalPrice * discount / 100) * 100
      ) / 100
    );

    selectedProduct.innerHTML = `
      <b>${esc(selected.name)} · ${esc(plan.name)}</b>
      <span>
        ${discount ? `<s>${money(originalPrice)}</s> ` : ''}
        ${money(amount)}
      </span>
    `;
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function openProduct(id) {
    selected = products.find(product => String(product.id) === String(id));
    if (!selected) return;

    const plans = parsePlans(selected);

    const image = $('#detail-image');
    const categoryElement = $('#detail-category');
    const title = $('#detail-title');
    const description = $('#detail-description');
    const meta = $('#detail-meta');
    const featuresElement = $('#detail-features');
    const planSelect = $('#plan-select');
    const download = $('#detail-download');
    const message = $('#order-message');

    if (image) {
      image.innerHTML = selected.image_url
        ? `<img src="${esc(selected.image_url)}" alt="${esc(selected.name)}">`
        : '<div class="detail-placeholder">SADEE PRO STORE</div>';
    }

    if (categoryElement) {
      categoryElement.textContent =
        (selected.category || 'DIGITAL PRODUCT').toUpperCase();
    }

    if (title) title.textContent = selected.name;

    if (description) {
      description.textContent =
        selected.description ||
        'Contact us for more information about this product.';
    }

    if (meta) {
      meta.innerHTML = [
        selected.version
          ? `<span>Version: ${esc(selected.version)}</span>`
          : '',
        selected.compatibility
          ? `<span>Compatibility: ${esc(selected.compatibility)}</span>`
          : '',
        selected.updated_date
          ? `<span>Updated: ${esc(selected.updated_date)}</span>`
          : ''
      ].filter(Boolean).join('');
    }

    let features = [];

    try {
      features = Array.isArray(selected.features)
        ? selected.features
        : JSON.parse(selected.features || '[]');
    } catch {
      features = [];
    }

    if (featuresElement) {
      featuresElement.innerHTML = features.length
        ? `
          <h3>Features</h3>
          <ul>${features.map(feature => `<li>${esc(feature)}</li>`).join('')}</ul>
        `
        : '';
    }

    if (download) {
      download.innerHTML =
        selected.download_url &&
        /^https:\/\//i.test(selected.download_url)
          ? `
            <a
              class="btn btn-outline full"
              href="${esc(selected.download_url)}"
              target="_blank"
              rel="noopener noreferrer"
            >Open download ↗</a>
            <p class="fine-print">
              Only download files shared by the store owner.
              Paid files should use protected delivery, not a public link.
            </p>
          `
          : '';
    }

    if (planSelect) {
      planSelect.innerHTML = plans.map((plan, index) => `
        <option value="${index}">
          ${esc(plan.name)} — ${money(plan.price)}
          ${plan.duration ? ` (${esc(plan.duration)})` : ''}
        </option>
      `).join('');

      planSelect.value = '0';
    }

    validatedPromo = '';
    validatedDiscount = 0;

    const promoMessage = $('#promo-preview-message');
    if (promoMessage) {
      promoMessage.textContent = 'Validate the code before paying.';
      promoMessage.className = 'fine-print';
    }

    form.reset();

    if (planSelect) {
      planSelect.value = '0';
      planSelect.onchange = updatePlan;
    }

    updatePlan();

    if (message) {
      message.textContent = '';
      message.className = 'form-message';
    }

    loadReviews(selected.id);

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  async function readFunctionJson(response, functionName) {
    const contentType = String(
      response.headers.get('content-type') || ''
    ).toLowerCase();

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      if (
        raw.trimStart().startsWith('<!DOCTYPE') ||
        raw.trimStart().startsWith('<html') ||
        contentType.includes('text/html')
      ) {
        throw new Error(
          `${functionName} returned an HTML page instead of JSON. ` +
          'Check that the Netlify Function is deployed and the URL is correct.'
        );
      }

      throw new Error(
        `${functionName} returned an invalid response (HTTP ${response.status}). Check Netlify Function logs.`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.message ||
        `${functionName} failed (HTTP ${response.status}).`
      );
    }

    return data;
  }

  async function loadReviews(productId) {
    const host = $('#detail-reviews');
    if (!host) return;

    const requestId = ++reviewRequestId;

    host.innerHTML = `
      <h3>Reviews & ratings</h3>
      <p class="fine-print">Loading approved reviews…</p>
    `;

    let rows = [];

    if (client) {
      try {
        const { data, error } = await client
          .from('product_reviews')
          .select('customer_name,rating,review_text,created_at')
          .eq('product_id', productId)
          .eq('approved', true)
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) throw error;
        rows = data || [];
      } catch (error) {
        console.error('Review loading failed:', error);
      }
    }

    if (requestId !== reviewRequestId || !host.isConnected) return;

    host.innerHTML = `
      <h3>Reviews & ratings</h3>

      ${
        rows.length
          ? rows.map(review => {
              const rating = Math.max(
                1,
                Math.min(5, Number(review.rating) || 5)
              );

              return `
                <article class="review-card">
                  <b>${esc(review.customer_name)}</b>
                  <span>${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>
                  <p>${esc(review.review_text || '')}</p>
                </article>
              `;
            }).join('')
          : '<p class="fine-print">No approved reviews yet.</p>'
      }

      <form id="review-form" class="review-form">
        <label>
          Your name
          <input name="customer_name" required maxlength="60">
        </label>

        <label>
          Rating
          <select name="rating">
            <option value="5">5 stars</option>
            <option value="4">4 stars</option>
            <option value="3">3 stars</option>
            <option value="2">2 stars</option>
            <option value="1">1 star</option>
          </select>
        </label>

        <label>
          Your review
          <textarea
            name="review_text"
            rows="2"
            maxlength="500"
            placeholder="Share your experience"
          ></textarea>
        </label>

        <button class="btn btn-outline" type="submit">
          Submit review
        </button>

        <p class="form-message" id="review-message"></p>
      </form>
    `;

    const reviewForm = $('#review-form', host);

    reviewForm?.addEventListener('submit', async event => {
      event.preventDefault();

      const currentForm = event.currentTarget;
      const message = $('#review-message', host);
      const submitButton = currentForm.querySelector('[type="submit"]');

      const fd = new FormData(currentForm);

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Submitting…';
      }

      try {
        const response = await fetch(
          '/.netlify/functions/submit-review',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              product_id: productId,
              customer_name: fd.get('customer_name'),
              rating: Number(fd.get('rating')),
              review_text: fd.get('review_text')
            })
          }
        );

        const result = await readFunctionJson(
          response,
          'Review submission'
        );

        if (message) {
          message.textContent =
            result.message || 'Review submitted for approval.';
          message.className = 'form-message success';
        }

        if (currentForm.isConnected) currentForm.reset();
      } catch (error) {
        if (message) {
          message.textContent = error.message;
          message.className = 'form-message';
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Submit review';
        }
      }
    });
  }

  // CLOSE PRODUCT MODAL

  $('#close-modal')?.addEventListener('click', closeModal);

  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  // SEARCH

  $('#search')?.addEventListener('input', render);

  // CATEGORY FILTERS

  $('#filters')?.querySelectorAll('[data-category]').forEach(button => {
    button.addEventListener('click', () => {
      category = button.dataset.category;

      $('#filters').querySelectorAll('.filter').forEach(filter => {
        filter.classList.toggle('active', filter === button);
      });

      render();
    });
  });

  // PROMO CODE VALIDATION

  $('#validate-promo')?.addEventListener('click', async () => {
    const promoInput = form.elements.namedItem('promo_code');
    const code = String(promoInput?.value || '')
      .trim()
      .toUpperCase();

    const message = $('#promo-preview-message');

    if (!message) return;

    if (!code) {
      validatedPromo = '';
      validatedDiscount = 0;
      message.textContent = 'Enter a code first.';
      updatePlan();
      return;
    }

    const button = $('#validate-promo');
    if (button) button.disabled = true;

    message.textContent = 'Checking code…';
    message.className = 'fine-print';

    try {
      const response = await fetch(
        '/.netlify/functions/validate-promo',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code })
        }
      );

      const result = await readFunctionJson(
        response,
        'Promo validation'
      );

      const discount = Number(result.discount_percent);

      if (
        !result.code ||
        !Number.isFinite(discount) ||
        discount < 0 ||
        discount > 100
      ) {
        throw new Error('The promo validation response is invalid.');
      }

      validatedPromo = String(result.code).toUpperCase();
      validatedDiscount = discount;

      message.textContent =
        `${validatedPromo} applied: ${discount}% off. ` +
        'Pay the discounted amount shown above.';

      message.className = 'fine-print success';

      updatePlan();
    } catch (error) {
      validatedPromo = '';
      validatedDiscount = 0;

      message.textContent = error.message;
      message.className = 'fine-print';

      updatePlan();
    } finally {
      if (button) button.disabled = false;
    }
  });

  form.elements.namedItem('promo_code')?.addEventListener(
    'input',
    () => {
      validatedPromo = '';
      validatedDiscount = 0;

      const message = $('#promo-preview-message');

      if (message) {
        message.textContent = 'Validate the code before paying.';
        message.className = 'fine-print';
      }

      updatePlan();
    }
  );

  // ORDER SUBMISSION

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (!selected) return;

    const planIndex = Number($('#plan-select')?.value) || 0;
    const plan = parsePlans(selected)[planIndex];

    if (!plan) return;

    const fd = new FormData(form);

    const name = String(fd.get('customer_name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const device = String(fd.get('device') || '').trim();
    const reference = String(fd.get('payment_reference') || '').trim();

    const message = $('#order-message');

    if (!message) return;

    if (!cfg.EZCASH_NUMBER) {
      message.textContent =
        'The store owner has not configured the eZ Cash number yet. Please contact support.';
      message.className = 'form-message';
      return;
    }

    if (!name || !email || !reference) {
      message.textContent = 'Please complete all required fields.';
      message.className = 'form-message';
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');

    if (!submitButton) return;

    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';

    message.textContent = '';
    message.className = 'form-message';

    try {
      let receiptPath = '';

      const receiptFile = fd.get('receipt_file');

      if (receiptFile instanceof File && receiptFile.size > 0) {
        if (receiptFile.size > 3 * 1024 * 1024) {
          throw new Error('Receipt image must be 3 MB or smaller.');
        }

        if (
          !['image/jpeg', 'image/png', 'image/webp']
            .includes(receiptFile.type)
        ) {
          throw new Error('Use a JPG, PNG or WebP receipt image.');
        }

        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = () => {
            resolve(
              String(reader.result).split(',')[1] || ''
            );
          };

          reader.onerror = () => {
            reject(new Error('Could not read receipt image.'));
          };

          reader.readAsDataURL(receiptFile);
        });

        /*
          IMPORTANT:
          This requires a working Netlify Function named upload-receipt.
          If that function does not exist in your project, receipt uploads
          will fail until the server-side upload function is added.
        */

        const uploadResponse = await fetch(
          '/.netlify/functions/upload-receipt',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              content_type: receiptFile.type,
              base64
            })
          }
        );

        const uploadResult = await readFunctionJson(
          uploadResponse,
          'Receipt upload'
        );

        if (!uploadResult.receipt_path) {
          throw new Error('Receipt upload did not return a receipt path.');
        }

        receiptPath = uploadResult.receipt_path;
      }

      const response = await fetch(
        '/.netlify/functions/create-order',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customer_name: name,
            email,
            device,
            payment_reference: reference,
            receipt_path: receiptPath,
            promo_code: String(fd.get('promo_code') || '').trim(),
            product_id: selected.id,
            plan_index: planIndex
          })
        }
      );

      const result = await readFunctionJson(
        response,
        'Order submission'
      );

      if (!result.order?.order_code) {
        throw new Error(
          'The order response is missing its order code. Contact store support.'
        );
      }

      const orderCode = String(result.order.order_code);
      const orderAmount = result.order.amount;

      const hue = Math.floor(Math.random() * 360);

      message.innerHTML = `
        <div class="order-success-card" style="--order-hue:${hue}">
          <span>ORDER RECEIVED · SYSTEM QUEUED</span>

          <small>YOUR ORDER CODE</small>

          <strong>${esc(orderCode)}</strong>

          <div class="order-success-actions">
            <button
              type="button"
              class="order-code-copy"
              id="copy-new-order"
            >Copy code</button>

            <a
              class="order-code-copy order-status-link"
              href="order-status.html?code=${encodeURIComponent(orderCode)}"
            >Open My Orders ↗</a>
          </div>

          <p>
            Amount due: ${money(orderAmount)}<br>
            Status: <b>Pending verification</b>
          </p>

          <small>
            After the store confirms your payment and issues your key,
            open My Orders to view, copy or share it.
          </small>
        </div>
      `;

      message.className = 'form-message success';

      $('#copy-new-order', message)?.addEventListener(
        'click',
        async () => {
          const copyButton = $('#copy-new-order', message);

          try {
            await navigator.clipboard.writeText(orderCode);

            if (copyButton) {
              copyButton.textContent = 'Copied ✓';
            }
          } catch {
            if (copyButton) {
              copyButton.textContent = 'Copy unavailable';
            }
          }
        }
      );

      form.reset();

      validatedPromo = '';
      validatedDiscount = 0;

      const planSelect = $('#plan-select');
      if (planSelect) planSelect.value = '0';

      updatePlan();

      const promoMessage = $('#promo-preview-message');
      if (promoMessage) {
        promoMessage.textContent = 'Validate the code before paying.';
      }

    } catch (error) {
      console.error('Order submission failed:', error);

      message.textContent =
        error.message ||
        'Could not submit order. Please contact support.';

      message.className = 'form-message';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit payment details ↗';
    }
  });

  // WHATSAPP SUPPORT

  const contactLink = $('#contact-link');

  if (contactLink) {
    const whatsappNumber = String(
      cfg.WHATSAPP_NUMBER || '94768472404'
    ).replace(/\D/g, '');

    contactLink.href = `https://wa.me/${whatsappNumber}`;
    contactLink.textContent = 'WhatsApp support ↗';
    contactLink.target = '_blank';
    contactLink.rel = 'noopener noreferrer';
  }

  // INITIALIZE

  updateLanguage();
  load();

})();
