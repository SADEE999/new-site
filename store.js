
async function loadReviews(productId) {
    const host = $('#detail-reviews');
    if (!host) return;

    host.innerHTML =
        '<h3>Reviews & ratings</h3><p class="fine-print">Loading approved reviews…</p>';

    let rows = [];

    if (client) {
        const { data, error } = await client
            .from('product_reviews')
            .select('customer_name,rating,review_text,created_at')
            .eq('product_id', productId)
            .eq('approved', true)
            .order('created_at', { ascending: false })
            .limit(20);

        if (!error) rows = data || [];
    }

    host.innerHTML = `
        <h3>Reviews & ratings</h3>

        ${
            rows.length
                ? rows.map(r => `
                    <article class="review-card">
                        <b>${esc(r.customer_name)}</b>
                        <span>
                            ${'★'.repeat(Number(r.rating))}
                            ${'☆'.repeat(5 - Number(r.rating))}
                        </span>
                        <p>${esc(r.review_text || '')}</p>
                    </article>
                `).join('')
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

    const reviewForm = $('#review-form');

    if (!reviewForm) return;

    reviewForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Keep a reference before any await.
        const currentForm = e.currentTarget;

        const fd = new FormData(currentForm);
        const m = $('#review-message');

        try {
            const r = await fetch(
                '/.netlify/functions/submit-review',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        product_id: productId,
                        customer_name: fd.get('customer_name'),
                        rating: Number(fd.get('rating')),
                        review_text: fd.get('review_text')
                    })
                }
            );

            const d = await readFunctionJson(r, 'Review submission');

            if (!currentForm.isConnected) return;

            m.textContent = d.message || 'Review submitted successfully.';
            m.className = 'form-message success';

            currentForm.reset();

        } catch (err) {
            if (!currentForm.isConnected) return;

            m.textContent = err.message || 'Could not submit review.';
            m.className = 'form-message';
        }
    });
}
