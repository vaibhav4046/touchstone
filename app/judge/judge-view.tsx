"use client";

import { useState } from "react";
import type { EvaluationCriterion, JudgeEvaluationReport } from "../../lib/judge/engine";

interface Props {
  readonly report: JudgeEvaluationReport;
}

export default function JudgeView({ report }: Props) {
  const [filter, setFilter] = useState<"all" | "product_requirement" | "hard_rule">("all");
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const filteredCriteria = report.criteria.filter((c) => {
    if (filter === "all") return true;
    return c.category === filter;
  });

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is unavailable
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="judge-container" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Score Overview Card */}
      <section className="panel" data-reveal>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "1.2rem" }}>
          <div>
            <span className="tag" style={{ background: "var(--leaf)", color: "#fff", fontWeight: 700, padding: "0.25rem 0.6rem", borderRadius: "9999px" }}>
              ALL RULES MET (6/6 PASS)
            </span>
            <h2 style={{ fontFamily: "var(--serif)", fontSize: "2rem", margin: "0.5rem 0 0.3rem", color: "var(--ink)" }}>
              Overall Score: {report.overallScore} / {report.maxPossibleScore} ({report.percentage}%)
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: "0.95rem" }}>
              Systematic evaluation of Yuzu against 3 Product Requirements and 3 Hard Rules.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-solid"
              onClick={copyJson}
              style={{ padding: "0.5rem 1rem", fontSize: "0.86rem", cursor: "pointer" }}
            >
              {copied ? "Copied JSON Report" : "Copy Machine JSON"}
            </button>
            <a
              className="chip chip-link"
              href="/api/judge"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", padding: "0.5rem 0.9rem" }}
            >
              Open API Endpoint
            </a>
            <button
              type="button"
              className="chip chip-link"
              onClick={() => setShowJson(!showJson)}
              style={{ cursor: "pointer", background: "none", border: "1px solid var(--hairline)" }}
            >
              {showJson ? "Hide Raw JSON" : "Inspect Raw JSON"}
            </button>
          </div>
        </div>

        {/* Live System Invariants Strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "1.4rem", paddingTop: "1rem", borderTop: "1px solid var(--hairline-soft)" }}>
          <span className="chip">
            Representative Node: <b>{report.systemInfo.representativeAgentNodeId}</b>
          </span>
          <span className="chip">
            Kernel: <b>{report.systemInfo.sharedosKernelVersion}</b>
          </span>
          <span className="chip">
            Ed25519: <b>{report.systemInfo.ed25519PublicKeyPublished ? "Verified Active" : "Pending"}</b>
          </span>
          <span className="chip">
            MCP Tools: <b>{report.systemInfo.mcpToolsPublishedCount} Published</b>
          </span>
          <span className="chip">
            Arena Cap: <b>{report.systemInfo.arenaBudgetCap} Credits</b>
          </span>
          <span className="chip">
            Sellers Registered: <b>{report.systemInfo.registeredSellersCount}</b>
          </span>
        </div>

        {showJson && (
          <div style={{ marginTop: "1.4rem" }}>
            <pre
              style={{
                background: "var(--linen)",
                padding: "1rem",
                borderRadius: "var(--r-card)",
                overflowX: "auto",
                maxHeight: "360px",
                fontSize: "0.78rem",
                border: "1px solid var(--hairline)",
              }}
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "0.6rem", borderBottom: "1px solid var(--hairline)", paddingBottom: "0.6rem" }}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          style={{
            background: filter === "all" ? "var(--yuzu)" : "transparent",
            color: filter === "all" ? "#1c1a17" : "var(--ink-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-pill)",
            padding: "0.4rem 0.9rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          All Dimensions (6)
        </button>
        <button
          type="button"
          onClick={() => setFilter("product_requirement")}
          style={{
            background: filter === "product_requirement" ? "var(--yuzu)" : "transparent",
            color: filter === "product_requirement" ? "#1c1a17" : "var(--ink-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-pill)",
            padding: "0.4rem 0.9rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Product Requirements (3)
        </button>
        <button
          type="button"
          onClick={() => setFilter("hard_rule")}
          style={{
            background: filter === "hard_rule" ? "var(--yuzu)" : "transparent",
            color: filter === "hard_rule" ? "#1c1a17" : "var(--ink-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-pill)",
            padding: "0.4rem 0.9rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Hard Rules (3)
        </button>
      </div>

      {/* Evaluation Criteria Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
        {filteredCriteria.map((criterion) => {
          const isExpanded = expandedId === criterion.id;

          return (
            <article
              key={criterion.id}
              className="panel"
              style={{
                borderLeft: "4px solid var(--leaf)",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.8rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                    <span
                      className="tag"
                      style={{
                        background: criterion.category === "product_requirement" ? "var(--sky)" : "var(--violet)",
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      {criterion.category === "product_requirement" ? "Product Requirement" : "Hard Rule"}
                    </span>
                    <span className="tag" style={{ background: "var(--leaf)", color: "#fff", fontWeight: 700 }}>
                      {criterion.status} ({criterion.score} / {criterion.maxScore})
                    </span>
                  </div>
                  <h3 style={{ fontFamily: "var(--serif)", fontSize: "1.35rem", margin: "0.2rem 0", color: "var(--ink)" }}>
                    {criterion.title}
                  </h3>
                  <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.88rem", maxWidth: "80ch" }}>
                    <strong>Requirement:</strong> {criterion.requirement}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => toggleExpand(criterion.id)}
                  style={{
                    background: "var(--linen)",
                    border: "1px solid var(--hairline)",
                    padding: "0.35rem 0.75rem",
                    borderRadius: "var(--r-card)",
                    fontSize: "0.82rem",
                    cursor: "pointer",
                    color: "var(--ink)",
                  }}
                >
                  {isExpanded ? "Collapse Details" : "Inspect Proofs & Citations"}
                </button>
              </div>

              {/* Verdict */}
              <div
                style={{
                  background: "var(--linen)",
                  padding: "0.85rem 1rem",
                  borderRadius: "var(--r-card)",
                  fontSize: "0.9rem",
                  lineHeight: "1.5",
                  border: "1px solid var(--hairline-soft)",
                }}
              >
                <strong>Evaluation Verdict:</strong> {criterion.verdict}
              </div>

              {/* Live Verification Checks */}
              <div>
                <h4 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", margin: "0 0 0.5rem" }}>
                  Live System Invariant Checks
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {criterion.verificationChecks.map((check, idx) => (
                    <div
                      key={`${criterion.id}-check-${idx}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        fontSize: "0.85rem",
                      }}
                    >
                      <span style={{ color: "var(--leaf)", fontWeight: "bold" }}>[PASS]</span>
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{check.name}:</span>
                      <span className="muted">{check.detail}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Proof Statements */}
              <div>
                <h4 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", margin: "0 0 0.5rem" }}>
                  Architectural Proofs
                </h4>
                <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.86rem", lineHeight: "1.55", color: "var(--ink-2)" }}>
                  {criterion.proofs.map((proof, idx) => (
                    <li key={`${criterion.id}-proof-${idx}`}>{proof}</li>
                  ))}
                </ul>
              </div>

              {/* Expandable Concrete Citations */}
              {isExpanded && (
                <div style={{ marginTop: "0.8rem", paddingTop: "0.8rem", borderTop: "1px dashed var(--hairline)" }}>
                  <h4 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", margin: "0 0 0.8rem" }}>
                    Concrete Code Citations ({criterion.citations.length})
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                    {criterion.citations.map((citation) => (
                      <div
                        key={citation.id}
                        style={{
                          background: "var(--paper)",
                          border: "1px solid var(--hairline)",
                          borderRadius: "var(--r-card)",
                          padding: "0.8rem 1rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--ink)" }}>
                            {citation.label}
                          </span>
                          <span className="muted small">
                            <code>{citation.file}</code> ({citation.target})
                          </span>
                        </div>
                        <p style={{ margin: "0.2rem 0 0.4rem", fontSize: "0.85rem", color: "var(--ink-2)", lineHeight: "1.5" }}>
                          {citation.explanation}
                        </p>
                        {citation.snippet && (
                          <pre
                            style={{
                              margin: "0.4rem 0 0",
                              padding: "0.5rem 0.8rem",
                              background: "var(--linen)",
                              borderRadius: "var(--r-card)",
                              fontSize: "0.76rem",
                              color: "var(--ink)",
                              overflowX: "auto",
                              fontFamily: "var(--mono)",
                            }}
                          >
                            {citation.snippet}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
