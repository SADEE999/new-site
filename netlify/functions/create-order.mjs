
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
  },
  body: JSON.stringify(body)
});

const getBaseUrl = () =>
  String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");

const getHeaders = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
};

async function rest(path, options = {}) {
  const baseUrl = getBaseUrl();

  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });
}

async function readResponse(response) {
  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text || "Empty response" };
  }

  return { data, text };
}

function logDatabaseError(stage, response, data) {
  console.error(`[SADEE STORE] ${stage} failed`, {
    httpStatus: response.status,
    code: data?.code || null,
    message: data?.message || data?.error || null,
    details: data?.details || null,
    hint: data?.hint || null
  });
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("[SADEE STORE] Missing Supabase server environment variables.");

    return json(503, {
      error: "Order service is not configured. Please contact the store owner."
    });
  }

  let d;

  try {
    d = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid request data." });
  }

  const name = String(d.customer_name || "").trim().slice(0, 80);
  const email = String(d.email || "").trim().toLowerCase().slice(0, 254);
  const device = String(d.device || "").trim().slice(0, 100);
  const reference = String(d.payment_reference || "").trim().slice(0, 100);
  const productId = String(d.product_id || "").trim();
  const receiptPath = String(d.receipt_path || "").trim().slice(0, 220);

  const promoCode = String(d.promo_code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 30);

  const planIndex = Number(d.plan_index);

  if (
    !name ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !reference ||
    !productId ||
    !Number.isInteger(planIndex) ||
    planIndex < 0
  ) {
    return json(400, {
      error: "Name, valid email, product, plan and payment reference are required."
    });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    return json(400, { error: "Invalid product ID." });
  }

  // 1. Check product
  let productResponse;

  try {
    productResponse = await rest(
      `products?select=id,name,plans,active,stock&id=eq.${encodeURIComponent(productId)}&active=eq.true&limit=1`
    );
  } catch (error) {
    console.error("[SADEE STORE] Product request failed:", error.message);

    return json(503, { error: "Could not connect to the store database." });
  }

  const productResult = await readResponse(productResponse);

  if (!productResponse.ok) {
    logDatabaseError("Product lookup", productResponse, productResult.data);

    return json(500, { error: "Could not check product availability." });
  }

  const products = Array.isArray(productResult.data)
    ? productResult.data
    : [];

  const product = products[0];

  if (!product || Number(product.stock || 0) <= 0) {
    return json(400, {
      error: "Product is out of stock or unavailable."
    });
  }

  // 2. Read plans
  let plans = [];

  try {
    plans = Array.isArray(product.plans)
      ? product.plans
      : JSON.parse(product.plans || "[]");
  } catch {
    plans = [];
  }

  if (!Array.isArray(plans) || plans.length === 0) {
    return json(400, {
      error: "This product has no purchase plans. Please contact the store owner."
    });
  }

  const plan = plans[planIndex];

  if (
    !plan ||
    !plan.name ||
    !Number.isFinite(Number(plan.price)) ||
    Number(plan.price) < 0
  ) {
    return json(400, { error: "Selected plan is invalid." });
  }

  // 3. Validate promo code
  let discountPercent = 0;

  if (promoCode) {
    let promoResponse;

    try {
      promoResponse = await rest(
        `promo_codes?select=code,discount_percent,active,starts_at,expires_at,max_uses,uses&code=eq.${encodeURIComponent(promoCode)}&limit=1`
      );
    } catch (error) {
      console.error("[SADEE STORE] Promo request failed:", error.message);

      return json(503, { error: "Could not validate promo code." });
    }

    const promoResult = await readResponse(promoResponse);

    if (!promoResponse.ok) {
      logDatabaseError("Promo lookup", promoResponse, promoResult.data);

      return json(500, { error: "Could not validate promo code." });
    }

    const promos = Array.isArray(promoResult.data)
      ? promoResult.data
      : [];

    const promo = promos[0];
    const now = Date.now();

    if (
      !promo ||
      !promo.active ||
      (promo.starts_at && new Date(promo.starts_at).getTime() > now) ||
      (promo.expires_at && new Date(promo.expires_at).getTime() < now) ||
      (
        promo.max_uses !== null &&
        promo.max_uses !== undefined &&
        Number(promo.uses) >= Number(promo.max_uses)
      )
    ) {
      return json(400, {
        error: "Promo code is invalid, expired or fully used."
      });
    }

    discountPercent = Number(promo.discount_percent) || 0;

    if (discountPercent < 0 || discountPercent > 90) {
      return json(400, { error: "Invalid promo discount." });
    }
  }

  // 4. Calculate price
  const originalAmount = Number(plan.price);

  const discountAmount =
    Math.round(originalAmount * discountPercent) / 100;

  const finalAmount = Math.max(
    0,
    Math.round((originalAmount - discountAmount) * 100) / 100
  );

  // 5. Create order
  const orderData = {
    customer_name: name,
    customer_email: email,
    device,
    product_id: product.id,
    product_name: product.name,
    plan_name: String(plan.name).slice(0, 100),
    amount: finalAmount,
    original_amount: originalAmount,
    discount_amount: discountAmount,
    promo_code: promoCode || null,
    payment_method: "eZ Cash",
    payment_reference: reference,
    receipt_path: receiptPath || null,
    status: "pending"
  };

  let orderResponse;

  try {
    orderResponse = await rest("store_orders", {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(orderData)
    });
  } catch (error) {
    console.error("[SADEE STORE] Order request failed:", error.message);

    return json(503, {
      error: "Could not connect to the order database. Please try again later."
    });
  }

  const orderResult = await readResponse(orderResponse);

  if (!orderResponse.ok) {
    logDatabaseError("Order creation", orderResponse, orderResult.data);

    const errorCode = orderResult.data?.code;
    const errorMessage = String(orderResult.data?.message || "").toLowerCase();
    const errorDetails = String(orderResult.data?.details || "").toLowerCase();
    const combinedError = `${errorMessage} ${errorDetails}`;

    if (
      errorCode === "23505" &&
      (
        combinedError.includes("payment_reference") ||
        combinedError.includes("store_orders_payment_reference")
      )
    ) {
      return json(409, {
        error: "This payment reference has already been used. Please check your transaction reference."
      });
    }

    if (errorCode === "23505") {
      return json(409, {
        error: "A duplicate order value was detected. Please contact the store owner."
      });
    }

    if (errorCode === "23503") {
      return json(400, {
        error: "The selected product is no longer valid. Please refresh the store."
      });
    }

    if (
      errorCode === "42703" ||
      errorCode === "42P01" ||
      errorCode === "PGRST204" ||
      errorCode === "PGRST205"
    ) {
      return json(500, {
        error: "The order database structure is incomplete. Please contact the store owner."
      });
    }

    return json(500, {
      error: "Order could not be saved. Please contact the store owner."
    });
  }

  const orders = Array.isArray(orderResult.data)
    ? orderResult.data
    : [];

  const order = orders[0];

  if (!order || !order.order_code) {
    console.error("[SADEE STORE] Order insert returned no order code.");

    return json(500, {
      error: "Order response was incomplete. Please contact the store owner."
    });
  }

  // 6. Increment promo usage after successful order creation
  if (promoCode) {
    try {
      const promoUpdate = await rest("rpc/increment_promo_use", {
        method: "POST",
        body: JSON.stringify({ p_code: promoCode })
      });

      if (!promoUpdate.ok) {
        const result = await readResponse(promoUpdate);
        logDatabaseError("Promo usage update", promoUpdate, result.data);
      }
    } catch (error) {
      console.error("[SADEE STORE] Promo usage update failed:", error.message);
    }
  }

  // 7. Return order information
  return json(200, {
    order: {
      order_code: order.order_code,
      status: order.status,
      amount: order.amount,
      original_amount: order.original_amount,
      discount_amount: order.discount_amount,
      product_name: order.product_name,
      plan_name: order.plan_name
    }
  });
}
