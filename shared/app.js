(() => {
  "use strict";

  const DATA = window.__PORTAL_DATA__;
  const TIER_ORDER = ["Starter", "Growth", "Volume"];
  const TIER_THRESHOLDS = DATA.tierThresholds;
  const CATALOG = DATA.catalog;

  const fmt = (n) => "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // qty: Record<productKey, number> — sparse map, default 0.
  // Everything else (gross value, tier, net subtotal, savings, line totals,
  // active chip, progress label/%) is derived on render, never stored, so the
  // displayed math can't drift out of sync with the inputs.
  const state = {
    qty: {},
    submitting: false,
    submitted: false,
    error: null
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
    submitNote: document.getElementById("submitNote")
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
      nameTitle.textContent = p.name;
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
    } catch (err) {
      state.error = err.message || "Something went wrong sending your order.";
    } finally {
      state.submitting = false;
      render();
    }
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
    els.submitBtn.disabled = belowMinimum || state.submitting;

    els.submitNote.classList.toggle("submit-note--error", !!state.error);
    if (state.error) {
      els.submitNote.textContent = state.error;
    } else if (state.submitting) {
      els.submitNote.textContent = "Sending…";
    } else if (state.submitted) {
      els.submitNote.textContent = "Sent — LockboxTCG will follow up to confirm your order";
    } else if (belowMinimum) {
      els.submitNote.textContent = "Add at least $" + TIER_THRESHOLDS.Starter + " (MSRP) to submit an order";
    } else {
      els.submitNote.textContent = "Sends your order straight to LockboxTCG";
    }
  }

  render();
})();
