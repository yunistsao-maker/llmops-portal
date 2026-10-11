import type { DeepDive } from "../../../schema/types";
import { linkTo, loaders, useData } from "../data";
import { PageHead, Status } from "../ui";

export default function Onboarding() {
  const manifest = useData(loaders.manifest);
  const catalog = useData(loaders.catalog);
  const dives = useData(async () => { const m = await loaders.manifest(); return Promise.all(m.models.map((id) => loaders.deepDive(id))); });
  if (!manifest.data || !catalog.data || !dives.data) return <Status error={manifest.error || catalog.error || dives.error} />;
  const name = (id: string) => catalog.data!.models.find((m) => m.id === id)?.name ?? id;
  const aliases = dives.data.flatMap((d: DeepDive) => d.onboarding.aliases.map((a) => ({ ...a, model: d.modelId })));
  const tiers = aliases.filter((a) => a.alias.startsWith("tier/"));
  const example = dives.data[0]?.onboarding;
  return (
    <>
      <PageHead eyebrow="給應用開發團隊" title="上手指南" />
      <section className="card">
        <h2>四個步驟開始使用</h2>
        <ol className="bullets" style={{ paddingLeft: 22, fontSize: 15 }}>
          <li><strong>申請 virtual key</strong>：透過 [申請入口] 以 SSO 申請，填用途、資料等級與預估用量；每個應用一把 key，各自有預算與速率上限。</li>
          <li><strong>選模型或能力層</strong>：一般用能力層 alias（下表），平台升級模型時不用改程式；需要可重現結果或特定資料處理地時，才釘選 <span className="mono">&lt;model&gt;@&lt;route&gt;</span>。</li>
          <li><strong>把 SDK 指向 gateway</strong>：OpenAI 或 Anthropic SDK 都可以，只改 base URL 與 key（範例如下）。</li>
          <li><strong>跑你的回歸測試</strong>：用自己的 golden set 比對現役模型，結果附在申請單上；上線後在 portal 追蹤 EOL 與價格變動。</li>
        </ol>
      </section>
      <div className="grid2">
        <section className="card">
          <h2>能力層 alias</h2>
          <table><thead><tr><th>Alias</th><th>目前指向</th><th>適合</th></tr></thead><tbody>
            {tiers.map((t) => <tr key={t.alias + t.model}><td className="mono">{t.alias}</td><td>{t.target}</td><td className="note">{catalog.data!.models.find((m) => m.id === t.model)?.bestFor[0]}</td></tr>)}
          </tbody></table>
          <p className="note">能力層切換走變更管理與 canary；指向改變時會出現在 Release Radar。</p>
        </section>
        <section className="card">
          <h2>範例：Python（OpenAI SDK）</h2>
          <pre className="code">{`from openai import OpenAI
import os

client = OpenAI(
    base_url="https://[GATEWAY_URL]/v1",
    api_key=os.environ["LLM_GATEWAY_KEY"],
)
resp = client.chat.completions.create(
    model="tier/general",
    messages=[{"role": "user", "content": "用三點摘要這份文件"}],
    reasoning_effort="low",
)
print(resp.choices[0].message.content, resp.model)`}</pre>
          <p className="note">記錄 <span className="mono">resp.model</span>：fallback 或 alias 切換時，實際回應的模型可能不同。</p>
        </section>
      </div>
      <section className="card">
        <h2>所有路由名稱</h2>
        <table><thead><tr><th>模型</th><th>呼叫名稱（model）</th><th>實際目標</th><th>說明</th></tr></thead><tbody>
          {aliases.filter((a) => !a.alias.startsWith("tier/")).map((a) => (
            <tr key={a.alias}><td><a href={linkTo(`models/${a.model}`)}>{name(a.model)}</a></td><td className="mono">{a.alias}</td><td className="mono note">{a.target}</td><td className="note">{a.note}</td></tr>))}
        </tbody></table>
      </section>
      <section className="card">
        <h2>各模型的參數注意事項</h2>
        {dives.data.map((d) => (
          <details key={d.modelId}>
            <summary>{name(d.modelId)}</summary>
            <table><tbody>{d.onboarding.parameterGuidance.map((p) => <tr key={p.parameter}><td className="mono" style={{ width: 240 }}>{p.parameter}</td><td>{p.guidance}</td></tr>)}</tbody></table>
            <p><a href={linkTo(`models/${d.modelId}`)}>完整 onboarding 步驟與程式範例 →</a></p>
          </details>))}
      </section>
      {example && (
        <div className="grid2">
          <section className="card"><h2>資料等級與可用路由</h2><p style={{ fontSize: 14, lineHeight: 1.8, margin: 0 }}>{example.dataClassification}</p></section>
          <section className="card"><h2>支援窗口</h2><p style={{ fontSize: 14, lineHeight: 1.8, margin: 0 }}>{example.support}</p></section>
        </div>)}
    </>
  );
}
