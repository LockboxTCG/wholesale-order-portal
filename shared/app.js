(() => {
  "use strict";

  const DATA = window.__PORTAL_DATA__;
  const TIER_ORDER = ["Starter", "Growth", "Volume"];
  const TIER_THRESHOLDS = DATA.tierThresholds;
  const CATALOG = DATA.catalog;

  const fmt = (n) => "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches;

  // Product names ending in "– <Color>" (e.g. "Single Matte Sleeves – White")
  // get a small swatch dot next to the title. Unrecognized/absent colors
  // just render with no swatch, same as before this existed.
  const COLOR_SWATCHES = {
    white: "#ffffff",
    black: "#111111",
    pink: "#f472b6",
    green: "#2f9e5b",
    red: "#dc3b2f",
    blue: "#2f6fdc",
    yellow: "#f2c53d",
    purple: "#8e5cd9",
    orange: "#e8792c",
    grey: "#9aa0a6",
    gray: "#9aa0a6",
    clear: "transparent"
  };

  function colorSwatchFor(name) {
    const m = String(name).match(/[–-]\s*([A-Za-z]+)\s*$/);
    if (!m) return null;
    return COLOR_SWATCHES[m[1].toLowerCase()] || null;
  }

  // qty: Record<productKey, number> — sparse map, default 0.
  // Everything else (gross value, tier, net subtotal, savings, line totals,
  // active chip, progress label/%) is derived on render, never stored, so the
  // displayed math can't drift out of sync with the inputs.
  const state = {
    qty: {},
    submitting: false,
    submitted: false,
    error: null,
    // The order most recently sent, and a fingerprint of the cart it was sent
    // from. The Submit button stays on "Order placed" until the cart changes,
    // so an unchanged order can't be sent twice by accident.
    lastOrder: null,
    sentSignature: null
  };

  function resolveTier(grossValue) {
    if (grossValue >= TIER_THRESHOLDS.Volume) return "Volume";
    if (grossValue >= TIER_THRESHOLDS.Growth) return "Growth";
    if (grossValue >= TIER_THRESHOLDS.Starter) return "Starter";
    return null;
  }

  // ---------- one-time DOM build ----------

  const els = {
    customerSlot: document.getElementById("customerSlot"),
    monthLabel: document.getElementById("monthLabel"),
    tierBadge: document.getElementById("tierBadge"),
    progressLabel: document.getElementById("progressLabel"),
    progressFill: document.getElementById("progressFill"),
    statGross: document.getElementById("statGross"),
    statSaved: document.getElementById("statSaved"),
    catalog: document.getElementById("catalog"),
    footerSubtotal: document.getElementById("footerSubtotal"),
    footerDiscount: document.getElementById("footerDiscount"),
    footerTier: document.getElementById("footerTier"),
    submitBtn: document.getElementById("submitBtn"),
    submitLabel: document.getElementById("submitLabel"),
    submitNote: document.getElementById("submitNote"),
    orderBanner: document.getElementById("orderBanner"),
    orderBannerDetail: document.getElementById("orderBannerDetail"),
    orderBannerView: document.getElementById("orderBannerView"),
    orderBannerNew: document.getElementById("orderBannerNew"),
    orderModal: document.getElementById("orderModal"),
    orderModalBackdrop: document.getElementById("orderModalBackdrop"),
    orderModalLead: document.getElementById("orderModalLead"),
    orderModalSummary: document.getElementById("orderModalSummary"),
    orderModalClose: document.getElementById("orderModalClose")
  };

  if (DATA.logoPath) {
    const img = document.createElement("img");
    img.className = "customer-logo";
    img.src = DATA.logoPath;
    img.alt = DATA.customerName;
    els.customerSlot.replaceWith(img);
  } else {
    els.customerSlot.textContent = "Customer logo here";
  }

  els.monthLabel.textContent = DATA.monthLabel;

  // rowRefs[key] = { totalEl, chipEls: { Starter, Growth, Volume }, msrp, tiers, name }
  const rowRefs = {};

  CATALOG.forEach((cat, ci) => {
    const card = document.createElement("section");
    card.className = "category-card";

    const strap = document.createElement("div");
    strap.className = "gold-strap";
    card.appendChild(strap);

    const inner = document.createElement("div");
    inner.className = "category-card__inner";

    const title = document.createElement("h2");
    title.className = "category-title";
    title.textContent = cat.category;
    inner.appendChild(title);

    cat.products.forEach((p, pi) => {
      const key = ci + "-" + pi;

      const row = document.createElement("div");
      row.className = "row";

      const nameBlock = document.createElement("div");
      nameBlock.className = "row__name";
      const nameTitle = document.createElement("div");
      nameTitle.className = "row__name-title";
      const swatchColor = colorSwatchFor(p.name);
      if (swatchColor) {
        const swatch = document.createElement("span");
        swatch.className = "color-swatch";
        swatch.style.backgroundColor = swatchColor;
        swatch.setAttribute("aria-hidden", "true");
        nameTitle.appendChild(swatch);
        nameBlock.classList.add("row__name--swatch");
      }
      nameTitle.appendChild(document.createTextNode(p.name));
      const msrp = document.createElement("div");
      msrp.className = "row__msrp";
      msrp.textContent = "MSRP " + fmt(p.msrp);
      nameBlock.appendChild(nameTitle);
      nameBlock.appendChild(msrp);

      const chips = document.createElement("div");
      chips.className = "row__chips";
      const chipEls = {};
      TIER_ORDER.forEach((t) => {
        const chip = document.createElement("div");
        chip.className = "chip";

        const tierEl = document.createElement("div");
        tierEl.className = "chip__tier";
        tierEl.textContent = t;

        const priceEl = document.createElement("div");
        priceEl.className = "chip__price";
        priceEl.textContent = fmt(p.tiers[t]);

        const discountEl = document.createElement("div");
        discountEl.className = "chip__discount";
        discountEl.textContent = "-" + Math.round((1 - p.tiers[t] / p.msrp) * 100) + "%";

        chip.appendChild(tierEl);
        chip.appendChild(priceEl);
        chip.appendChild(discountEl);
        chips.appendChild(chip);
        chipEls[t] = chip;
      });

      const qtyWrap = document.createElement("div");
      qtyWrap.className = "row__qty";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.value = "0";
      input.setAttribute("aria-label", "Quantity for " + p.name);
      input.inputMode = "numeric";
      if (IS_TOUCH) {
        // Tapping the pre-filled "0" would otherwise leave you typing "05".
        input.addEventListener("focus", () => {
          if (input.value === "0") input.value = "";
        });
        input.addEventListener("blur", () => {
          if (input.value === "") input.value = "0";
        });
      }
      input.addEventListener("input", (e) => {
        const v = Math.max(0, parseInt(e.target.value, 10) || 0);
        state.qty[key] = v;
        render();
      });
      qtyWrap.appendChild(input);

      const total = document.createElement("div");
      total.className = "row__total";
      total.textContent = fmt(0);

      row.appendChild(nameBlock);
      row.appendChild(chips);
      row.appendChild(qtyWrap);
      row.appendChild(total);
      inner.appendChild(row);

      rowRefs[key] = { totalEl: total, chipEls, msrp: p.msrp, tiers: p.tiers, name: p.name };
    });

    card.appendChild(inner);
    els.catalog.appendChild(card);
  });

  els.submitBtn.addEventListener("click", submitOrder);

  // ---------- submit ----------

  async function submitOrder() {
    if (els.submitBtn.disabled || state.submitting) return;

    let grossValue = 0;
    Object.keys(rowRefs).forEach((key) => {
      grossValue += (state.qty[key] || 0) * rowRefs[key].msrp;
    });
    const tier = resolveTier(grossValue);

    let netSubtotal = 0;
    const items = [];
    Object.keys(rowRefs).forEach((key) => {
      const ref = rowRefs[key];
      const q = state.qty[key] || 0;
      if (q <= 0) return;
      const unitPrice = tier ? ref.tiers[tier] : ref.msrp;
      const lineTotal = q * unitPrice;
      netSubtotal += lineTotal;
      items.push({ name: ref.name, qty: q, msrp: ref.msrp, unitPrice, lineTotal });
    });
    const saved = Math.max(0, grossValue - netSubtotal);

    const signature = cartSignature();

    state.submitting = true;
    state.error = null;
    render();

    try {
      const res = await fetch("/api/submit-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: DATA.slug,
          customerName: DATA.customerName,
          customerEmail: DATA.customerEmail,
          monthLabel: DATA.monthLabel,
          tier,
          items,
          grossValue,
          netSubtotal,
          saved
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Something went wrong sending your order.");
      }
      state.submitted = true;
      state.sentSignature = signature;

      const order = { at: Date.now(), monthLabel: DATA.monthLabel, tier, grossValue, netSubtotal, saved, items };
      state.lastOrder = order;
      rememberOrder(order);
      showOrderBanner(order);
      openOrderModal(order);
    } catch (err) {
      state.error = err.message || "Something went wrong sending your order.";
    } finally {
      state.submitting = false;
      render();
    }
  }

  // ---------- order placed: confirmation dialog + banner ----------

  const ORDER_KEY = "lockbox-last-order:" + DATA.slug;
  let lastFocus = null;

  // Fingerprint of the cart (which products, how many). Used to keep the
  // Submit button on "Order placed" until the quantities actually change.
  function cartSignature() {
    return Object.keys(state.qty)
      .filter((k) => state.qty[k] > 0)
      .sort()
      .map((k) => k + ":" + state.qty[k])
      .join("|");
  }

  function formatWhen(ms) {
    return new Date(ms).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  }

  // Remembered on this device only, so coming back to the page later in the
  // month still shows that an order went through. Storage can be blocked
  // (private mode etc.); the on-screen confirmation works without it.
  function rememberOrder(order) {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch (e) {
      /* ignore */
    }
  }

  function recallOrder() {
    try {
      const order = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
      return order && order.monthLabel === DATA.monthLabel ? order : null;
    } catch (e) {
      return null;
    }
  }

  function orderLine(label, amount, extraClass) {
    const line = document.createElement("div");
    line.className = "order-line" + (extraClass ? " " + extraClass : "");
    const l = document.createElement("span");
    l.textContent = label;
    const a = document.createElement("span");
    a.className = "order-line__amount";
    a.textContent = amount;
    line.appendChild(l);
    line.appendChild(a);
    return line;
  }

  function showOrderBanner(order) {
    if (!els.orderBanner) return;
    els.orderBannerDetail.textContent =
      formatWhen(order.at) + " · " + fmt(order.netSubtotal) + (order.tier ? " · " + order.tier + " tier" : "") +
      ". We'll follow up by email with your invoice and timeline.";
    els.orderBanner.hidden = false;
  }

  function openOrderModal(order) {
    if (!els.orderModal) return;
    els.orderModalLead.textContent = "Thanks, " + DATA.customerName + ". We've received your " + order.monthLabel + " order.";

    const box = els.orderModalSummary;
    box.textContent = "";
    order.items.forEach((it) => box.appendChild(orderLine(it.name + " × " + it.qty, fmt(it.lineTotal))));

    const totals = document.createElement("div");
    totals.className = "order-totals";
    totals.appendChild(orderLine("Placed", formatWhen(order.at)));
    if (order.tier) totals.appendChild(orderLine("Tier", order.tier));
    if (order.saved > 0) totals.appendChild(orderLine("You saved", fmt(order.saved), "order-line--saving"));
    totals.appendChild(orderLine("Subtotal", fmt(order.netSubtotal), "order-line--total"));
    box.appendChild(totals);

    lastFocus = document.activeElement;
    els.orderModal.hidden = false;
    document.body.style.overflow = "hidden";
    els.orderModalClose.focus();
  }

  function closeOrderModal() {
    if (!els.orderModal || els.orderModal.hidden) return;
    els.orderModal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    // The banner sits near the top of the page; bring it into view.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewOrder() {
    state.qty = {};
    state.submitted = false;
    state.sentSignature = null;
    state.error = null;
    document.querySelectorAll(".row__qty input").forEach((input) => {
      input.value = "0";
    });
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (els.orderModal) {
    els.orderModalClose.addEventListener("click", closeOrderModal);
    els.orderModalBackdrop.addEventListener("click", closeOrderModal);
    els.orderBannerView.addEventListener("click", () => {
      if (state.lastOrder) openOrderModal(state.lastOrder);
    });
    els.orderBannerNew.addEventListener("click", startNewOrder);
    document.addEventListener("keydown", (e) => {
      if (els.orderModal.hidden) return;
      if (e.key === "Escape") closeOrderModal();
      // One focusable control in the dialog, so keep focus on it.
      if (e.key === "Tab") {
        e.preventDefault();
        els.orderModalClose.focus();
      }
    });
  }

  // ---------- derived render ----------

  function render() {
    // Tier is resolved from list-price (MSRP) order value, then that tier's
    // wholesale rates are applied to compute the actual amount owed — this
    // avoids the price/tier circularity that using net value would create.
    let grossValue = 0;
    Object.keys(rowRefs).forEach((key) => {
      grossValue += (state.qty[key] || 0) * rowRefs[key].msrp;
    });
    const tier = resolveTier(grossValue);

    let netSubtotal = 0;
    Object.keys(rowRefs).forEach((key) => {
      const ref = rowRefs[key];
      const q = state.qty[key] || 0;
      const unit = tier ? ref.tiers[tier] : ref.msrp;
      const lineTotal = q * unit;
      netSubtotal += lineTotal;
      ref.totalEl.textContent = fmt(lineTotal);
      ref.totalEl.classList.toggle("is-zero", lineTotal === 0);
      TIER_ORDER.forEach((t) => {
        ref.chipEls[t].classList.toggle("is-active", t === tier);
      });
    });

    const saved = Math.max(0, grossValue - netSubtotal);

    let progressLabel, pct;
    if (!tier) {
      const toGo = TIER_THRESHOLDS.Starter - grossValue;
      progressLabel = toGo > 0 ? fmt(toGo) + " to unlock Starter pricing" : "Starter pricing unlocked";
      pct = Math.min(100, (grossValue / TIER_THRESHOLDS.Starter) * 100);
    } else if (tier === "Volume") {
      progressLabel = "Top tier unlocked";
      pct = 100;
    } else {
      const next = TIER_ORDER[TIER_ORDER.indexOf(tier) + 1];
      const span = TIER_THRESHOLDS[next] - TIER_THRESHOLDS[tier];
      progressLabel = fmt(TIER_THRESHOLDS[next] - grossValue) + " to " + next + " tier";
      pct = Math.min(100, Math.max(0, ((grossValue - TIER_THRESHOLDS[tier]) / span) * 100));
    }

    els.tierBadge.textContent = tier ? tier + " tier" : "Below minimum";
    if (tier) {
      els.tierBadge.setAttribute("data-tier", tier);
    } else {
      els.tierBadge.removeAttribute("data-tier");
    }

    els.progressLabel.textContent = progressLabel;
    els.progressFill.style.width = pct + "%";

    els.statGross.textContent = fmt(grossValue);
    els.statSaved.textContent = fmt(saved);

    els.footerSubtotal.textContent = fmt(netSubtotal);
    els.footerDiscount.textContent = fmt(saved);
    els.footerTier.textContent = tier || "—";

    const belowMinimum = !tier || grossValue <= 0;
    // True while the cart is exactly what was just sent; changing any
    // quantity makes it a different order again.
    const alreadySent = state.submitted && cartSignature() === state.sentSignature;
    els.submitBtn.disabled = belowMinimum || state.submitting || alreadySent;
    if (els.submitLabel) {
      els.submitLabel.textContent = state.submitting ? "Sending…" : alreadySent ? "Order placed" : "Submit order";
    }
    if (els.orderBannerNew) els.orderBannerNew.hidden = grossValue <= 0;

    els.submitNote.classList.toggle("submit-note--error", !!state.error);
    if (state.error) {
      els.submitNote.textContent = state.error;
    } else if (state.submitting) {
      els.submitNote.textContent = "Sending…";
    } else if (alreadySent) {
      els.submitNote.textContent = "Sent to LockboxTCG. Change your quantities to place another order.";
    } else if (belowMinimum) {
      els.submitNote.textContent = "Add at least $" + TIER_THRESHOLDS.Starter + " (MSRP) to submit an order";
    } else {
      els.submitNote.textContent = "Sends your order straight to LockboxTCG";
    }
  }

  const remembered = recallOrder();
  if (remembered) {
    state.lastOrder = remembered;
    showOrderBanner(remembered);
  }

  render();
})();
