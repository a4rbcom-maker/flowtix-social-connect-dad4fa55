// Sync Messenger conversations for a Page.
// API-first: use Graph API whenever we can extract a session token. If Graph
// cannot return conversations, fallback is Business Suite NETWORK payloads only
// (never DOM selectors), then validate/dedupe before reporting contacts.

const {
  extractGraphTokenFromSession,
  validatePageAccessFromGraph,
  extractConversationsViaGraph,
  extractConversationsViaBusinessNetwork,
  dedupeAndValidateContacts,
  emitPipelineLog,
  shortError,
} = require("./messenger-stable-pipeline");

async function runMessengerSyncCookies({ page, job, report }) {
  const { pageId, pageName = null, maxConversations = 5000 } = job.payload || {};
  if (!pageId) {
    await report({ status: "failed", errorMessage: "اختر صفحة أولاً." });
    return;
  }
  if (!/^\d{5,}$/.test(String(pageId))) {
    await report({
      status: "failed",
      errorMessage: "معرّف الصفحة غير صحيح. اضغط «جلب صفحاتي المدارة» مرة أخرى ثم اختر الصفحة من القائمة.",
    });
    return;
  }

  await report({ status: "running", progress: 10, processedItems: 0, totalItems: 0 });

  let contacts = [];
  let graphToken = null;
  let validatedPage = null;

  try {
    const extracted = await extractGraphTokenFromSession(page, report);
    graphToken = extracted.token;
  } catch (error) {
    await emitPipelineLog(report, "token_extract", "failed", "فشل استخراج توكن Graph من الجلسة", { error: shortError(error) });
  }

  if (graphToken) {
    try {
      validatedPage = await validatePageAccessFromGraph(graphToken, pageId, report);
      const graphResult = await extractConversationsViaGraph(
        validatedPage.access_token,
        pageId,
        validatedPage.name || pageName,
        maxConversations,
        report,
      );
      contacts = graphResult.contacts;
    } catch (error) {
      await emitPipelineLog(report, "graph_conversations", "failed", "Graph API لم يرجع المحادثات، سنجرب قراءة الشبكة", {
        error: shortError(error),
      });
    }
  } else {
    await emitPipelineLog(report, "token_extract", "failed", "لم يتم العثور على توكن Graph داخل الجلسة", {});
  }

  if (contacts.length === 0) {
    try {
      const networkResult = await extractConversationsViaBusinessNetwork(page, pageId, pageName, maxConversations, report);
      contacts = networkResult.contacts;
    } catch (error) {
      await report({
        status: "failed",
        progress: 100,
        errorMessage: `فشل استخراج مراسلي الصفحة. السبب: ${shortError(error)}`,
      });
      return;
    }
  }

  const finalContacts = dedupeAndValidateContacts(contacts, pageId, validatedPage?.name || pageName);
  await emitPipelineLog(report, "validate_results", finalContacts.length ? "ok" : "failed", `تم اعتماد ${finalContacts.length} عميل بعد التنظيف`, {
    received: contacts.length,
    accepted: finalContacts.length,
  });

  if (finalContacts.length === 0) {
    await report({
      status: "failed",
      progress: 100,
      errorMessage: "لم نجد عملاء صالحين لهذه الصفحة. إما لا توجد محادثات، أو صلاحية الرسائل غير متاحة للحساب.",
    });
    return;
  }

  let done = 0;
  for (const c of finalContacts) {
    await report({
      result: {
        target: c.psid,
        status: "success",
        data: {
          kind: "messenger_contact",
          psid: c.psid,
          full_name: c.full_name,
          page_id: pageId,
          page_name: c.page_name,
          conversation_id: c.conversation_id,
          profile_pic_url: c.profile_pic_url,
          profile_url: c.profile_url,
          last_message_at: c.last_message_at,
          messages_count: c.messages_count,
          unread_count: c.unread_count,
          last_message_preview: c.last_message_preview,
          source: c.source,
        },
      },
      processedItems: ++done,
      totalItems: finalContacts.length,
      progress: Math.min(99, Math.round((done / finalContacts.length) * 100)),
    });
  }
  await report({ status: "completed", processedItems: done, totalItems: finalContacts.length, progress: 100 });
}

module.exports = { runMessengerSyncCookies };