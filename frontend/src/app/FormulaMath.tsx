// Q-266: one KaTeX formula. `htmlAndMathml` gives screen readers the MathML. If KaTeX throws, the
// plain-text twin is shown instead, so the panel is never blank.
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function renderLatex(latex: string): string | null {
  try {
    return katex.renderToString(latex, {
      output: 'htmlAndMathml',
      throwOnError: true,
      displayMode: true,
      trust: false,
      strict: 'error',
    });
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('[confidence] KaTeX failed, using plain text', err);
    return null;
  }
}

export function FormulaMath({
  latex,
  plain,
  testId,
}: {
  latex: string;
  plain: string | readonly string[];
  testId?: string;
}) {
  const html = renderLatex(latex);
  if (html === null) {
    const lines = typeof plain === 'string' ? [plain] : plain;
    return (
      <code className="sx-acc-eq" data-testid={testId} data-fallback="true">
        {lines.map((l, k) => (
          <span key={k} className="block">
            {l}
          </span>
        ))}
      </code>
    );
  }
  return (
    <div
      className="sx-acc-tex"
      data-testid={testId}
      // KaTeX output for a string built from numbers by confidenceFormula.ts; `trust: false`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
