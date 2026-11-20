import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function money(value) {
  return Number(value || 0).toLocaleString("mn-MN") + " ₮";
}

function parseAreaFromSize(size) {
  // Жишээ: "1. 1.5 × 2.2 м, 1 ш" эсвэл "1.5x2.2"
  const match = String(size || "").match(/(\d+(?:[.,]\d+)?)\s*[×xX*]\s*(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const width = Number(match[1].replace(",", "."));
  const height = Number(match[2].replace(",", "."));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width * height;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST хүсэлт шаардлагатай." });
  }

  try {
    const accessToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return res.status(401).json({ error: "Нэвтрэх эрх олдсонгүй." });

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: "Нэвтрэлт хүчингүй байна." });

    const { data: admin, error: adminError } = await supabase
      .from("admin_users").select("role, owner_user_id").eq("user_id", user.id).maybeSingle();
    if (adminError || !admin || !["admin", "employee"].includes(admin.role)) {
      return res.status(403).json({ error: "Ажилтны эсвэл админы эрх шаардлагатай." });
    }

    const ownerUserId = admin.owner_user_id || user.id;
    const isAdmin = admin.role === "admin";
    if (!isAdmin) return res.status(403).json({ error: "Захиалгын төлөв, төлбөр болон дуусгалтын мэдээллийг зөвхөн админ өөрчилнө." });
    const { orderId, newStatus, confirmationIncome, remainingIncome, unpaidBalance } = req.body || {};
    const allowedStatuses = ["Шинэ", "Холбогдсон", "Үнийн санал", "Баталгаажсан", "Дууссан"];
    if (!orderId || !allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ error: "Захиалга эсвэл төлөв буруу байна." });
    }

    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!order) return res.status(404).json({ error: "Захиалга олдсонгүй." });

    const workPending = "Хүлээгдэж байна";
    const productionStatus = order.production_status || workPending;
    const assemblyStatus = order.installation_status || workPending;
    const siteInstallationStatus = order.site_installation_status || workPending;
    if (newStatus === "Дууссан" && String(order.status || "") !== "Дууссан" &&
        [productionStatus, assemblyStatus, siteInstallationStatus].some(value => value !== "Дууссан")) {
      return res.status(409).json({
        error: "Захиалгыг дуусгахын өмнө үйлдвэрлэл, угсралт, суурилуулалтын гурван шат бүгд Дууссан байх шаардлагатай."
      });
    }
    if (["Шинэ", "Холбогдсон", "Үнийн санал"].includes(newStatus) &&
        [productionStatus, assemblyStatus, siteInstallationStatus].some(value => value !== workPending && value !== "Эхлээгүй" && value !== "Төлөвлөсөн")) {
      return res.status(409).json({
        error: "Ажлын явц эхэлсэн тул захиалгын төлөвийг буцаах боломжгүй. Админ ажлын дарааллыг шалгана уу."
      });
    }

    // Ижил төлөвийг дахин сонгоход Messenger-т давхар мэдэгдэл/үнийн санал илгээхгүй.
    const currentStatus = String(order.status || "Шинэ").startsWith("Шинэ захиалга")
      ? "Шинэ"
      : String(order.status || "Шинэ");
    if (req.body?.updateUnpaidBalanceOnly === true) {
      const amount = Number(unpaidBalance);
      if (!isAdmin) return res.status(403).json({ error: "Үлдэгдэл засах эрх зөвхөн админд байна." });
      if (newStatus !== "Дууссан" || currentStatus !== "Дууссан" ||
          !Number.isFinite(amount) || amount < 0 || amount > 100000000000) {
        return res.status(400).json({ error: "Дууссан захиалгын төлөгдөөгүй үлдэгдлийн дүн буруу байна." });
      }
      const { error: balanceUpdateError } = await supabase.from("orders")
        .update({ unpaid_balance: amount })
        .eq("id", orderId)
        .eq("user_id", ownerUserId);
      if (balanceUpdateError) return res.status(500).json({ error: "Үлдэгдэл хадгалж чадсангүй: " + balanceUpdateError.message });
      return res.status(200).json({ success: true, message: "Төлөгдөөгүй үлдэгдэл шинэчлэгдлээ." });
    }

    if (req.body?.markUnpaidBalancePaid === true) {
      if (!isAdmin) return res.status(403).json({ error: "Үлдэгдэл төлөгдсөнөөр тэмдэглэх эрх зөвхөн админд байна." });
      if (newStatus !== "Дууссан" || currentStatus !== "Дууссан") {
        return res.status(400).json({ error: "Зөвхөн дууссан захиалгын үлдэгдлийг төлөгдсөнөөр тэмдэглэнэ." });
      }
      const entryDate = String(req.body?.entryDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        return res.status(400).json({ error: "Төлбөрийн огноо буруу байна." });
      }
      const { data: paymentResult, error: paymentError } = await supabase.rpc("mark_order_unpaid_balance_paid", {
        p_order_id: orderId,
        p_owner_user_id: ownerUserId,
        p_actor_user_id: user.id,
        p_entry_date: entryDate
      });
      if (paymentError) return res.status(500).json({ error: "Үлдэгдэл төлбөрийн орлого бүртгэж чадсангүй: " + paymentError.message });
      return res.status(200).json({
        success: true,
        amount: Number(paymentResult?.amount || 0),
        alreadyPaid: Boolean(paymentResult?.already_paid),
        incomeRecorded: Boolean(paymentResult?.income_recorded),
        message: paymentResult?.already_paid
          ? "Энэ захиалгын үлдэгдэл өмнө нь төлөгдсөн байна."
          : "Үлдэгдэл төлбөр орлогод бүртгэгдэж, захиалгын үлдэгдэл 0 боллоо."
      });
    }

    if (!isAdmin && (["Баталгаажсан", "Дууссан"].includes(newStatus) || ["Баталгаажсан", "Дууссан"].includes(currentStatus))) {
      return res.status(403).json({ error: "Баталгаажуулах, дуусгах болон эдгээр төлөвтэй захиалгыг өөрчлөх эрх зөвхөн админд байна." });
    }

    if (currentStatus === newStatus) {
      return res.status(409).json({
        error: newStatus === "Үнийн санал"
          ? "Энэ захиалгад үнийн санал өмнө нь илгээгдсэн байна. Давхар илгээхээс хамгааллаа."
          : "Захиалга аль хэдийн энэ төлөвтэй байна."
      });
    }

    if (newStatus === "Дууссан" && (!Number.isFinite(Number(unpaidBalance)) || Number(unpaidBalance) < 0 || Number(unpaidBalance) > 100000000000)) {
      return res.status(400).json({ error: "Гараар оруулсан төлөгдөөгүй үлдэгдлийн дүн буруу байна." });
    }

    const pageToken = process.env.PAGE_ACCESS_TOKEN;

    // Үнийн санал төлөв сонгоход эхлээд харилцагчаас Messenger-ээр авах эсэхийг асууна.
    if (newStatus === "Үнийн санал") {
      if (!order.messenger_sender_id) {
        return res.status(400).json({
          error: "Энэ захиалгад Messenger хэрэглэгчийн ID байхгүй тул үнийн саналын асуулт илгээх боломжгүй."
        });
      }
      if (!pageToken) {
        return res.status(500).json({ error: "Messenger-ийн Page тохиргоо олдсонгүй." });
      }

      const messengerResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: order.messenger_sender_id },
          message: {
            text: "Сайн байна уу, " + (order.customer_name || "хүндэт харилцагч") +
              " аа. 😊\\n\\nТаны захиалгын үнийн санал бэлэн боллоо. Messenger-ээр үнийн саналаа авах уу?",
            quick_replies: [
              { content_type: "text", title: "Тийм, авъя", payload: "SEND_ORDER_QUOTE:" + order.id },
              { content_type: "text", title: "Үгүй, баярлалаа", payload: "DECLINE_ORDER_QUOTE:" + order.id }
            ]
          },
          access_token: pageToken
        })
      });
      const messengerResult = await messengerResponse.json();
      if (!messengerResponse.ok || messengerResult.error) {
        console.error("Messenger quote question send error:", messengerResult);
        return res.status(502).json({
          error: "Үнийн санал авах эсэх асуулт Messenger-ээр илгээгдсэнгүй. Захиалгын төлөв өөрчлөгдөөгүй."
        });
      }
    }

    // Баталгаажсан үед урьдчилгаа эсвэл бүтэн төлбөрийг тусдаа ангиллаар бүртгэнэ.
    let confirmationIncomeEntryId = null;
    let confirmationIncomeAlreadyRecorded = false;
    if (newStatus === "Баталгаажсан") {
      const amount = Number(confirmationIncome?.amount);
      const paymentType = confirmationIncome?.paymentType === "full" ? "full" : confirmationIncome?.paymentType === "deposit" ? "deposit" : "";
      const entryDate = String(confirmationIncome?.entryDate || "").trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000 || !paymentType ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        return res.status(400).json({ error: "Төлбөрийн төрөл, бодитоор авсан орлогын дүн эсвэл огноо буруу байна." });
      }
      const category = paymentType === "deposit" ? "Урьдчилгаа орлого" : "Бүтэн төлбөрийн орлого";
      const { data: priorIncome, error: priorIncomeError } = await supabase
        .from("finance_entries").select("id").eq("user_id", ownerUserId).eq("order_id", orderId)
        .eq("entry_type", "income").eq("category", category).limit(1).maybeSingle();
      if (priorIncomeError) return res.status(500).json({ error: "Өмнөх орлогыг шалгаж чадсангүй: " + priorIncomeError.message });
      if (priorIncome) {
        confirmationIncomeAlreadyRecorded = true;
      } else {
        const { data: insertedIncome, error: incomeInsertError } = await supabase
          .from("finance_entries").insert({
            user_id: ownerUserId, created_by: user.id, order_id: orderId, entry_type: "income",
            amount, category, description: category + ": " + (confirmationIncome.description || "Бодитоор хүлээн авсан төлбөр"),
            entry_date: entryDate
          }).select("id").single();
        if (incomeInsertError) return res.status(500).json({ error: "Орлого бүртгэж чадсангүй. Захиалгын төлөв өөрчлөгдөөгүй: " + incomeInsertError.message });
        confirmationIncomeEntryId = insertedIncome.id;
      }
    }

    // Дуусгах үеийн үлдэгдлийг захиалгын нийт үнэ болон өмнө бүртгэсэн бүх орлогоос сервер дээр дахин тооцно.
    if (newStatus === "Дууссан") {
      const totalPrice = Number(order.price);
      if (!Number.isFinite(totalPrice) || totalPrice < 0) {
        return res.status(400).json({ error: "Захиалгын нийт үнэ буруу тул үлдэгдэл тооцож чадсангүй." });
      }
      const { data: priorIncomeRows, error: priorIncomeRowsError } = await supabase
        .from("finance_entries")
        .select("amount")
        .eq("user_id", ownerUserId)
        .eq("order_id", orderId)
        .eq("entry_type", "income");
      if (priorIncomeRowsError) {
        return res.status(500).json({ error: "Өмнөх орлогын бүртгэлийг шалгаж чадсангүй: " + priorIncomeRowsError.message });
      }
      const totalReceivedBeforeCompletion = (priorIncomeRows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const expectedOutstanding = Math.max(0, totalPrice - totalReceivedBeforeCompletion);
      const receivedNow = Number(remainingIncome?.amount ?? 0);
      const unpaidNow = Number(unpaidBalance);
      if (totalReceivedBeforeCompletion > totalPrice ||
          !Number.isFinite(receivedNow) || receivedNow < 0 ||
          !Number.isFinite(unpaidNow) || unpaidNow < 0 ||
          Math.abs((receivedNow + unpaidNow) - expectedOutstanding) > 0.01) {
        return res.status(400).json({
          error: "Үлдэгдлийн тооцоо зөрүүтэй байна. Захиалгын үнэ болон өмнө бүртгэсэн орлогыг шалгаад дахин оролдоно уу.",
          expectedOutstanding
        });
      }
    }

    // Дууссан үед бодитоор авсан үлдэгдэл төлбөрийг тусдаа орлогоор бүртгэнэ.
    let remainingIncomeEntryId = null;
    let remainingIncomeAlreadyRecorded = false;
    if (newStatus === "Дууссан" && remainingIncome) {
      const amount = Number(remainingIncome.amount);
      const entryDate = String(remainingIncome.entryDate || "").trim();
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000000000 || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        return res.status(400).json({ error: "Үлдэгдэл орлогын дүн эсвэл огноо буруу байна." });
      }
      if (amount > 0) {
        const { data: priorRemaining, error: priorRemainingError } = await supabase
          .from("finance_entries").select("id").eq("user_id", ownerUserId).eq("order_id", orderId)
          .eq("entry_type", "income").eq("category", "Үлдэгдэл орлого").limit(1).maybeSingle();
        if (priorRemainingError) return res.status(500).json({ error: "Өмнөх үлдэгдэл орлогыг шалгаж чадсангүй: " + priorRemainingError.message });
        if (priorRemaining) {
          remainingIncomeAlreadyRecorded = true;
        } else {
          const { data: insertedRemaining, error: remainingInsertError } = await supabase
            .from("finance_entries").insert({
              user_id: ownerUserId, created_by: user.id, order_id: orderId, entry_type: "income",
              amount, category: "Үлдэгдэл орлого",
              description: "Захиалгын үлдэгдэл төлбөр: " + String(remainingIncome.description || "").slice(0, 500),
              entry_date: entryDate
            }).select("id").single();
          if (remainingInsertError) return res.status(500).json({ error: "Үлдэгдэл орлого бүртгэж чадсангүй. Захиалгын төлөв өөрчлөгдөөгүй: " + remainingInsertError.message });
          remainingIncomeEntryId = insertedRemaining.id;
        }
      }
    }

    const statusChangeStartedAt = new Date().toISOString();
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(newStatus === "Дууссан"
        ? { status: newStatus, unpaid_balance: Number(unpaidBalance) }
        : { status: newStatus })
      .eq("id", orderId)
      .eq("user_id", ownerUserId)
      .select("id, status, messenger_sender_id, messenger_order_number")
      .maybeSingle();

    if (updateError || !updatedOrder) {
      if (confirmationIncomeEntryId) {
        await supabase.from("finance_entries").delete().eq("id", confirmationIncomeEntryId).eq("user_id", ownerUserId);
      }
      if (remainingIncomeEntryId) {
        await supabase.from("finance_entries").delete().eq("id", remainingIncomeEntryId).eq("user_id", ownerUserId);
      }
      if (updateError) return res.status(500).json({ error: updateError.message });
      return res.status(404).json({ error: "Захиалга олдсонгүй." });
    }

    // Service-key update нь trigger дотор auth.uid()-г хоосон болгодог тул
    // яг энэ хүсэлтээр үүссэн түүхийн мөрөнд баталгаажсан нэвтэрсэн хэрэглэгчийг холбоно.
    const { data: statusHistoryRows, error: statusHistoryLookupError } = await supabase
      .from("order_history")
      .select("id")
      .eq("order_id", orderId)
      .eq("user_id", ownerUserId)
      .eq("event_type", "updated")
      .is("actor_user_id", null)
      .eq("old_values->>status", currentStatus)
      .eq("new_values->>status", newStatus)
      .gte("created_at", statusChangeStartedAt)
      .order("created_at", { ascending: false })
      .limit(1);

    if (statusHistoryLookupError) {
      console.error("Order history actor lookup error:", statusHistoryLookupError);
    } else if (statusHistoryRows?.[0]?.id) {
      const { error: actorUpdateError } = await supabase
        .from("order_history")
        .update({ actor_user_id: user.id })
        .eq("id", statusHistoryRows[0].id)
        .eq("user_id", ownerUserId)
        .is("actor_user_id", null);
      if (actorUpdateError) console.error("Order history actor update error:", actorUpdateError);
    }

    if (newStatus !== "Үнийн санал" && updatedOrder.messenger_sender_id && pageToken) {
      const orderNumber = updatedOrder.messenger_order_number || "";
      const message = newStatus === "Баталгаажсан"
        ? "✅ Таны " + orderNumber + " дугаартай захиалгын төлбөрийг админ шалгаж баталгаажууллаа. Баярлалаа!"
        : "Таны " + orderNumber + " дугаартай захиалгын төлөв шинэчлэгдлээ: " + newStatus + ".";

      try {
        const notifyResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: updatedOrder.messenger_sender_id },
            message: { text: message },
            access_token: pageToken
          })
        });
        const notifyResult = await notifyResponse.json();
        if (!notifyResponse.ok || notifyResult.error) {
          console.error("Messenger status notification error:", notifyResult);
        }
      } catch (notifyError) {
        console.error("Messenger status notification error:", notifyError);
      }
    }

    const completionMessage = newStatus === "Баталгаажсан"
      ? (confirmationIncomeEntryId
          ? "Захиалга баталгаажлаа. Урьдчилгаа/бүтэн төлбөрийн орлого тайланд бүртгэгдлээ."
          : confirmationIncomeAlreadyRecorded
            ? "Захиалга баталгаажлаа. Энэ захиалгын орлого өмнө бүртгэгдсэн тул давхар нэмсэнгүй."
            : "Захиалга баталгаажлаа.")
      : newStatus === "Дууссан"
        ? "Захиалга дууслаа. ＋ Зардал хэсгээр бүртгэсэн зардал, бодитоор авсан төлбөр болон гараар оруулсан төлөгдөөгүй авлагыг хадгаллаа."
        : "Захиалгын төлөв шинэчлэгдлээ.";

    return res.status(200).json({
      success: true,
      notificationSent: newStatus === "Үнийн санал" || Boolean(updatedOrder.messenger_sender_id && pageToken),
      incomeRecorded: Boolean(confirmationIncomeEntryId),
      incomeAlreadyRecorded: confirmationIncomeAlreadyRecorded,
      remainingIncomeRecorded: Boolean(remainingIncomeEntryId),
      remainingIncomeAlreadyRecorded,
      message: newStatus === "Үнийн санал"
        ? "Үнийн санал авах эсэх асуулт харилцагчийн Messenger рүү илгээгдэж, төлөв шинэчлэгдлээ."
        : completionMessage
    });
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json({ error: "Серверийн алдаа гарлаа." });
  }
}
