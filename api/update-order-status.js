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
    const { orderId, newStatus, confirmationIncome, completionExpense, remainingIncome, unpaidBalance } = req.body || {};
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

    // Ижил төлөвийг дахин сонгоход Messenger-т давхар мэдэгдэл/үнийн санал илгээхгүй.
    const currentStatus = String(order.status || "Шинэ").startsWith("Шинэ захиалга")
      ? "Шинэ"
      : String(order.status || "Шинэ");
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

    // Үнийн санал төлөв сонгоход хэмжээг эхлээд захиалгын хэмжээсээс шалгаж бодно.
    if (newStatus === "Үнийн санал") {
      if (!order.messenger_sender_id) {
        return res.status(400).json({
          error: "Энэ захиалгад Messenger хэрэглэгчийн ID байхгүй тул үнийн санал илгээх боломжгүй."
        });
      }
      if (!pageToken) {
        return res.status(500).json({ error: "Messenger-ийн Page тохиргоо олдсонгүй." });
      }

      const quoteItems = Array.isArray(order.quote_items) ? order.quote_items : [];
      const orderNumber = order.messenger_order_number || order.id;
      let totalArea = 0;
      let fixedTotal = 0;
      const hasNegotiableItems = quoteItems.some(item => item.pricing_mode === "labor_only");

      const itemLines = quoteItems.length
        ? quoteItems.map((item, index) => {
            const quantity = Math.max(1, Number(item.quantity || 1));
            const areaPerUnit = Number(item.area || 0);
            const itemArea = areaPerUnit * quantity;
            const negotiable = item.pricing_mode === "labor_only";
            const lineTotal = negotiable ? 0 : Number(item.total_price || 0);
            totalArea += itemArea;
            fixedTotal += lineTotal;

            const measurement = item.width != null && item.height != null
              ? "Хэмжээ: " + item.width + " × " + item.height + " м × " + quantity + " ш"
              : "Талбай: " + itemArea.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²";

            return (index + 1) + ". " + (item.product_type || "Бүтээгдэхүүн") + "\n" +
              measurement + "\n" +
              (item.area != null ? "Нийт талбай: " + itemArea.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²\n" : "") +
              (negotiable
                ? "Ажлын хөлс: Харилцан тохиролцоно"
                : "Нэгж үнэ: " + money(item.unit_price) + "/м²\nДүн: " + money(lineTotal));
          })
        : [
            (order.product || "Бүтээгдэхүүн") + "\n" +
            "Хэмжээ: " + (order.size || "—") + "\n" +
            "Дүн: " + (order.price == null ? "Тохиролцоно" : money(order.price))
          ];

      if (!quoteItems.length) {
        totalArea = Number(order.area_per_unit || parseAreaFromSize(order.size) || 0) * Number(order.quantity || 1);
        fixedTotal = order.price == null ? 0 : Number(order.price);
      }

      const totalLine = hasNegotiableItems
        ? (fixedTotal > 0 ? money(fixedTotal) + " + ажлын хөлс тохиролцоно" : "Ажлын хөлсийг харилцан тохиролцоно")
        : (order.price == null ? "Үнийг харилцан тохиролцоно" : money(quoteItems.length ? fixedTotal : order.price));

      const quoteText =
        "📋 МОНГОЛ МЕТАЛЛ ХИЙЦ — ҮНИЙН САНАЛ\n\n" +
        "Сайн байна уу, " + (order.customer_name || "хүндэт харилцагч") + " аа.\n" +
        "Таны захиалгын үнийн саналыг хүргэж байна.\n\n" +
        "Захиалгын дугаар: " + orderNumber + "\n\n" +
        itemLines.join("\n\n") + "\n\n" +
        "--------------------\n" +
        "Нийт талбай: " + totalArea.toLocaleString("mn-MN", { maximumFractionDigits: 2 }) + " м²\n" +
        "НИЙТ ДҮН: " + totalLine + "\n\n" +
        "Энэхүү үнийн саналтай танилцаад асуух зүйл байвал энэ чатанд хариу бичээрэй.\n" +
        "Баярлалаа. — Монгол металл хийц";

      if (quoteText.length > 1900) {
        return res.status(400).json({
          error: "Үнийн саналын мэдээлэл хэт урт байна. Бүтээгдэхүүний мөрүүдийг цөөлөөд дахин илгээнэ үү."
        });
      }

      const messengerResponse = await fetch("https://graph.facebook.com/v26.0/me/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: order.messenger_sender_id },
          message: { text: quoteText },
          access_token: pageToken
        })
      });
      const messengerResult = await messengerResponse.json();

      if (!messengerResponse.ok || messengerResult.error) {
        console.error("Messenger quote send error:", messengerResult);
        return res.status(502).json({
          error: "Үнийн санал Messenger-ээр илгээгдсэнгүй. Захиалгын төлөв өөрчлөгдөөгүй."
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

    // Захиалга дуусгах үеийн нийт зарлагыг бүртгэнэ.
    let completionExpenseEntryId = null;
    let completionExpenseAlreadyRecorded = false;
    if (newStatus === "Дууссан" && completionExpense && Number(completionExpense.amount) > 0) {
      const amount = Number(completionExpense.amount);
      const category = String(completionExpense.category || "").trim();
      const description = String(completionExpense.description || "").trim();
      const entryDate = String(completionExpense.entryDate || "").trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000 ||
          !category || category.length > 120 ||
          description.length > 500 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        return res.status(400).json({ error: "Зарлагын дүн, ангилал эсвэл огноо буруу байна." });
      }

      const { data: priorExpense, error: priorExpenseError } = await supabase
        .from("finance_entries")
        .select("id")
        .eq("user_id", ownerUserId)
        .eq("order_id", orderId)
        .eq("entry_type", "expense")
        .ilike("description", "Дуусгах үеийн зарлага:%")
        .limit(1)
        .maybeSingle();
      if (priorExpenseError) return res.status(500).json({ error: "Өмнөх зарлагыг шалгаж чадсангүй: " + priorExpenseError.message });

      if (priorExpense) {
        completionExpenseAlreadyRecorded = true;
      } else {
        const expenseDescription = "Дуусгах үеийн зарлага: " + (description || "Нийт зардал");
        const { data: insertedExpense, error: expenseInsertError } = await supabase
          .from("finance_entries")
          .insert({
            user_id: ownerUserId,
            created_by: user.id,
            order_id: orderId,
            entry_type: "expense",
            amount,
            category,
            description: expenseDescription,
            entry_date: entryDate
          })
          .select("id")
          .single();
        if (expenseInsertError) return res.status(500).json({ error: "Зарлага бүртгэж чадсангүй. Захиалгын төлөв өөрчлөгдөөгүй: " + expenseInsertError.message });
        completionExpenseEntryId = insertedExpense.id;
      }
    }

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
      if (completionExpenseEntryId) {
        await supabase.from("finance_entries").delete().eq("id", completionExpenseEntryId).eq("user_id", ownerUserId);
      }
      if (remainingIncomeEntryId) {
        await supabase.from("finance_entries").delete().eq("id", remainingIncomeEntryId).eq("user_id", ownerUserId);
      }
      if (updateError) return res.status(500).json({ error: updateError.message });
      return res.status(404).json({ error: "Захиалга олдсонгүй." });
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
        ? "Захиалга дууслаа. Нийт зарлага, бодитоор авсан төлбөр болон гараар оруулсан төлөгдөөгүй авлагыг хадгаллаа."
        : "Захиалгын төлөв шинэчлэгдлээ.";

    return res.status(200).json({
      success: true,
      notificationSent: newStatus === "Үнийн санал" || Boolean(updatedOrder.messenger_sender_id && pageToken),
      incomeRecorded: Boolean(confirmationIncomeEntryId),
      incomeAlreadyRecorded: confirmationIncomeAlreadyRecorded,
      remainingIncomeRecorded: Boolean(remainingIncomeEntryId),
      remainingIncomeAlreadyRecorded,
      expenseRecorded: Boolean(completionExpenseEntryId),
      message: newStatus === "Үнийн санал"
        ? "Үнийн санал харилцагчийн Messenger рүү илгээгдэж, төлөв шинэчлэгдлээ."
        : completionMessage
    });
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json({ error: "Серверийн алдаа гарлаа." });
  }
}
