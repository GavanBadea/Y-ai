// زر تحميل قالب Excel + استيراد من ملف
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import api from "@/services/api";
import {
  downloadExcelTemplate,
  parseExcelFile,
  formatImportResult,
} from "@/utils/excelImport";

export default function ExcelImportButton({
  endpoint,
  templateFilename,
  templateHeaders,
  exampleRows = [],
  onSuccess,
  size = "sm",
}) {
  const { isAdmin } = useAuth();
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  if (!isAdmin) return null;

  const handleTemplate = async () => {
    try {
      await downloadExcelTemplate(templateFilename, templateHeaders, exampleRows);
    } catch (e) {
      alert("خطأ في تحميل القالب: " + (e.message || e));
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setLoading(true);
    try {
      const rows = await parseExcelFile(file);
      const data = await api.post(endpoint, { rows });
      alert(formatImportResult(data));
      if (data.added > 0 && onSuccess) onSuccess();
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "فشل الاستيراد";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Button variant="secondary" size={size} onClick={handleTemplate} disabled={loading}>
        📥 قالب Excel
      </Button>
      <Button
        variant="secondary"
        size={size}
        loading={loading}
        onClick={() => fileRef.current?.click()}
      >
        📤 استيراد Excel
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
}
