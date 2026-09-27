"use strict";

// Sends a list of items through sendOne() in fixed-size batches, waiting
// delayMs between batches (never after the last one) — spaces bursts out
// to protect Gmail sender reputation/deliverability on a real monthly send
// to every customer, instead of firing them all at once.

async function sendInBatches(items, { batchSize, delayMs, sendOne }) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    for (const item of batch) {
      await sendOne(item);
    }

    const isLastBatch = i + batchSize >= items.length;
    if (!isLastBatch) {
      console.log(`Sent a batch of ${batch.length} — waiting ${delayMs / 60000} min before the next batch…`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { sendInBatches };
