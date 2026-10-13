/** Thermal printer page setup. 80 mm paper has ~72 mm printable width; 58 mm ~48 mm. */
export function PrintStyles({ width }: { width: "80mm" | "58mm" }) {
  const printable = width === "80mm" ? "72mm" : "48mm";
  return (
    <style>{`
      @page { size: ${width} auto; margin: 0; }
      html, body { background: #fff !important; color: #000 !important; }
      body { margin: 0; }
      .ticket { width: ${printable}; margin: 0 auto; padding: 3mm 0; font: 12px/1.35 ui-monospace, "Courier New", monospace; }
      .ticket h1 { font-size: 15px; margin: 0; text-align: center; }
      .ticket .c { text-align: center; }
      .ticket .r { text-align: right; }
      .ticket .row { display: flex; justify-content: space-between; gap: 6px; }
      .ticket .muted { color: #333; }
      .ticket hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
      .ticket .big { font-size: 22px; font-weight: 700; }
      .ticket .bold { font-weight: 700; }
      .ticket img { display: block; margin: 0 auto 4px; max-height: 48px; max-width: 60%; filter: grayscale(1); }
      @media screen { body { background: #e5e5e5 !important; } .ticket { background: #fff; padding: 4mm; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
    `}</style>
  );
}

/** Calls window.print() once loaded when ?auto=1 (used by the POS print iframe). */
export function AutoPrint() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `if (new URLSearchParams(location.search).get("auto") === "1") { window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); }); }`,
      }}
    />
  );
}
