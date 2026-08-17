window.__ModuleLoader__.load({
  id: "dsh-finreport",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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
var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;
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
  const [status, setStatus] = import_react.default.useState(null);
  const [preview, setPreview] = import_react.default.useState(null);
  const [busy, setBusy] = import_react.default.useState(null);
  const [error, setError] = import_react.default.useState(null);
  const [notice, setNotice] = import_react.default.useState(null);
  const [lang, setLang] = import_react.default.useState("zh");
  const refresh = import_react.default.useCallback(async (signal) => {
    try {
      setStatus(await unwrap(rpcCall, "report.status", {}, signal));
      setError(null);
    } catch (err) {
      if (err?.name !== "AbortError") setError(String(err?.message ?? err));
    }
  }, [rpcCall]);
  import_react.default.useEffect(() => {
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
      const value = await unwrap(rpcCall, "report.generate", { language: lang });
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
      const value = await unwrap(rpcCall, "report.send", { language: lang });
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
      "\u6BCF\u5929\u5B9A\u65F6\u751F\u6210\u4E2D\u6587\u8D22\u7ECF\u65E5\u62A5\u5E76\u901A\u8FC7\u5DF2\u63A5\u5165\u7684 IM \u901A\u9053\u63A8\u9001\uFF08WhatsApp/Telegram/Discord/\u98DE\u4E66/\u9489\u9489/\u4F01\u5FAE/QQ/\u5FAE\u4FE1\uFF0C\u4F9D\u8D56 dsh-im \u5404\u901A\u9053\u7684 bot.sendText \u7AEF\u70B9\uFF09\u3002"
    ),
    h(
      "div",
      { style: { background: "#f6f6f6", borderRadius: "8px", padding: "12px", margin: "12px 0" } },
      status ? [
        h(Field, { key: "s1", label: "\u5168\u5C40\u8C03\u5EA6", value: `\u6BCF\u5929 ${status.schedule}\uFF08${status.timezone}\uFF09${status.enabled ? "" : "\xB7 \u5DF2\u505C\u7528"}` }),
        h(Field, {
          key: "s2",
          label: "\u6295\u9012\u76EE\u6807",
          value: (status.targets || []).map((t) => `${t.channel}[${t.index}] ${t.language} ${t.schedule}@${t.timezone} \u2192 ${(status.deliveryTargets || [])[t.index]?.target ?? ""}`).join("\n") || "\u672A\u914D\u7F6E"
        }),
        h(Field, { key: "s3", label: "\u6700\u8FD1\u53D1\u9001", value: status.lastSentDate ? `${status.lastSentDate} ${status.lastSentAt ? `(${new Date(status.lastSentAt).toLocaleString()})` : ""}` : "\u5C1A\u672A\u53D1\u9001" }),
        h(Field, { key: "s4", label: "\u4E0B\u6B21\u8FD0\u884C", value: (status.targets || []).map((t) => `${t.channel}: ${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "\u2014"}`).join("\uFF1B") || "\u2014" }),
        h(Field, { key: "s5", label: "\u804A\u5929\u5185\u89E6\u53D1", value: status.toolRegistered ? "finreport_send \u5DE5\u5177\u5DF2\u6CE8\u518C" : "\u672A\u6CE8\u518C" }),
        h(Field, { key: "s6", label: "\u6570\u636E\u76EE\u5F55", value: status.dataDir }),
        h(Field, { key: "s7", label: "\u4E0A\u6B21\u9519\u8BEF", value: status.lastError ?? "\u65E0" })
      ] : h("p", null, "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001\u2026")
    ),
    h(
      "div",
      { style: { display: "flex", gap: "8px", marginBottom: "12px", alignItems: "center" } },
      h(
        "select",
        {
          value: lang,
          onChange: (e) => setLang(e.target.value),
          style: { padding: "6px 8px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "13px" }
        },
        h("option", { value: "zh" }, "\u4E2D\u6587"),
        h("option", { value: "en" }, "English")
      ),
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
