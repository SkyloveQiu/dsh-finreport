window.__ModuleLoader__.load({
  id: "dsh-finreport",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin-src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  default: () => index_default,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var h = React.createElement;
var name = "finreport-settings";
var inject = ["slots", "connection"];
var CHANNEL = "/finreport";
async function unwrap(rpcCall, endpoint, payload = {}, signal) {
  const result = await rpcCall(endpoint, payload, signal);
  const inner = result?.result ?? result;
  if (!inner || typeof inner.ok !== "boolean") {
    throw new Error("finreport \u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!inner.ok) {
    const error = new Error(inner.error?.message ?? "finreport \u64CD\u4F5C\u5931\u8D25");
    error.code = inner.error?.code;
    throw error;
  }
  return inner.value;
}
function Button({ children, onClick, disabled, kind = "secondary" }) {
  return h("button", {
    type: "button",
    onClick,
    disabled,
    style: {
      padding: "6px 14px",
      borderRadius: "6px",
      cursor: disabled ? "default" : "pointer",
      border: kind === "primary" ? "none" : "1px solid #ccc",
      background: kind === "primary" ? "#2563eb" : "#fff",
      color: kind === "primary" ? "#fff" : "#111",
      fontSize: "13px"
    }
  }, children);
}
function Field({ label, value }) {
  return h(
    "div",
    { style: { marginBottom: "8px" } },
    h("span", { style: { color: "#888", marginRight: "8px", fontSize: "12px" } }, label),
    h("span", { style: { fontSize: "13px" } }, String(value ?? "\u2014"))
  );
}
function FinreportSettingsTab({ rpcCall }) {
  const [status, setStatus] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const refresh = React.useCallback(async (signal) => {
    try {
      setStatus(await unwrap(rpcCall, "report.status", {}, signal));
      setError(null);
    } catch (err) {
      if (err?.name !== "AbortError") setError(String(err?.message ?? err));
    }
  }, [rpcCall]);
  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 15e3);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  const onGenerate = async () => {
    setBusy("generate");
    setNotice(null);
    setError(null);
    try {
      const value = await unwrap(rpcCall, "report.generate", {});
      setPreview(value.text);
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };
  const onSend = async () => {
    setBusy("send");
    setNotice(null);
    setError(null);
    try {
      const value = await unwrap(rpcCall, "report.send", {});
      setNotice(`\u5DF2\u53D1\u9001: ${JSON.stringify(value)}`);
      setPreview(null);
      await refresh();
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };
  return h(
    "div",
    { style: { maxWidth: "640px", fontFamily: "system-ui, sans-serif" } },
    h("h3", null, "\u{1F4CA} \u8D22\u7ECF\u65E5\u62A5"),
    h(
      "p",
      { style: { color: "#666", fontSize: "13px" } },
      "\u6BCF\u5929\u5B9A\u65F6\u751F\u6210\u4E2D\u6587\u8D22\u7ECF\u65E5\u62A5\u5E76\u901A\u8FC7 WhatsApp \u63A8\u9001\uFF08\u4F9D\u8D56 dsh-im \u7684 bot.sendText \u7AEF\u70B9\uFF09\u3002"
    ),
    h(
      "div",
      { style: { background: "#f6f6f6", borderRadius: "8px", padding: "12px", margin: "12px 0" } },
      status ? [
        h(Field, { key: "s1", label: "\u8C03\u5EA6", value: `\u6BCF\u5929 ${status.schedule}\uFF08${status.timezone}\uFF09${status.enabled ? "" : "\xB7 \u5DF2\u505C\u7528"}` }),
        h(Field, { key: "s2", label: "\u6700\u8FD1\u53D1\u9001", value: status.lastSentDate ? `${status.lastSentDate} ${status.lastSentAt ? `(${new Date(status.lastSentAt).toLocaleString()})` : ""}` : "\u5C1A\u672A\u53D1\u9001" }),
        h(Field, { key: "s3", label: "\u4E0B\u6B21\u8FD0\u884C", value: status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : "\u2014" }),
        h(Field, { key: "s4", label: "\u6570\u636E\u76EE\u5F55", value: status.dataDir }),
        h(Field, { key: "s5", label: "\u4E0A\u6B21\u9519\u8BEF", value: status.lastError ?? "\u65E0" })
      ] : h("p", null, "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001\u2026")
    ),
    h(
      "div",
      { style: { display: "flex", gap: "8px", marginBottom: "12px" } },
      h(Button, { kind: "primary", onClick: onSend, disabled: busy !== null }, busy === "send" ? "\u53D1\u9001\u4E2D\u2026" : "\u7ACB\u5373\u53D1\u9001"),
      h(Button, { onClick: onGenerate, disabled: busy !== null }, busy === "generate" ? "\u751F\u6210\u4E2D\u2026" : "\u751F\u6210\u9884\u89C8")
    ),
    error ? h("p", { style: { color: "#c00", fontSize: "13px" } }, `\u26A0\uFE0F ${error}`) : null,
    notice ? h("p", { style: { color: "#0a7d32", fontSize: "13px" } }, `\u2705 ${notice}`) : null,
    preview ? h("pre", {
      style: {
        background: "#0d1117",
        color: "#e6edf3",
        borderRadius: "8px",
        padding: "12px",
        fontSize: "12px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: "480px",
        overflow: "auto"
      }
    }, preview) : null
  );
}
function apply(ctx) {
  const rpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(CHANNEL, endpoint, payload, signal);
  ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
    name: "settings.plugins.tab",
    id: "finreport",
    order: 30,
    label: "\u8D22\u7ECF\u65E5\u62A5",
    inject: () => ({ rpcCall })
  }, FinreportSettingsTab));
}
var index_default = { name, inject, apply };

    return module.exports;
  }
});
