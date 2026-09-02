// src/pages/settings/CompanySettings.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout               from "@/components/layout/AppLayout";
import { Card }                from "@/components/ui/Card";
import Button                  from "@/components/ui/Button";
import Input                   from "@/components/ui/Input";
import api                     from "@/services/api";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { useLanguage } from "@/context/LanguageContext";
// tr via Input/Button; titles via t()

const FIELD_KEYS = [
  { key: "CompanyInformation_Name",   labelKey: "company.companyName", placeholderKey: "company.companyName" },
  { key: "CompanyInformation_Mobile", labelKey: "company.phone",       placeholderKey: "company.phone" },
  { key: "CompanyInformation_Adress", labelKey: "company.address",     placeholderKey: "company.address" },
  { key: "CompanyInformation_TaxNo",  labelKey: "company.taxNo",       placeholderKey: "company.taxNoPlaceholder" },
  { key: "CompanyInformation_Info1",  labelKey: "company.info1",       placeholderKey: "company.info1" },
  { key: "CompanyInformation_Info2",  labelKey: "company.info2",       placeholderKey: "company.info2" },
];

const empty = Object.fromEntries(
  [...FIELD_KEYS.map((f) => [f.key, ""]), ["CurrencySymbol", "د.ع"]]
);

export default function CompanySettings() {
  const navigate = useNavigate();
  const { company, refresh } = useCompany();
  const { t, tr } = useLanguage();
  const fileRef = useRef(null);
  const [form,    setForm   ] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving ] = useState(false);
  const [logoBusy,setLogoBusy] = useState(false);
  const [msg,     setMsg    ] = useState(null);

  useEffect(() => {
    api.get("/company")
      .then((res) => {
        if (res.data) {
          const sym = res.data.CurrencySymbol === "$" ? "$" : "د.ع";
          setForm({ ...empty, ...res.data, CurrencySymbol: sym });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (company && Object.keys(company).length) {
      const sym = company.CurrencySymbol === "$" ? "$" : "د.ع";
      setForm((p) => ({ ...p, ...company, CurrencySymbol: sym }));
    }
  }, [company]);

  const set = (key) => (val) => {
    setForm((p) => ({ ...p, [key]: val }));
    setMsg(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.CompanyInformation_Name?.trim()) {
      setMsg({ type: "error", text: t("company.nameRequired") });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        CurrencySymbol: form.CurrencySymbol === "$" ? "$" : "د.ع",
      };
      await api.post("/company", payload);
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setMsg({ type: "error", text: err.message || t("company.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMsg({ type: "error", text: t("company.pickImage") });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMsg({ type: "error", text: t("company.logoMaxSize") });
      return;
    }
    setLogoBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post("/company/logo", { image: reader.result });
        await refresh();
        setMsg({ type: "success", text: t("company.logoUploaded") });
      } catch (err) {
        setMsg({ type: "error", text: err.message || t("company.logoFailed") });
      } finally {
        setLogoBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLogoDelete = async () => {
    if (!confirm(t("company.deleteLogoConfirm"))) return;
    setLogoBusy(true);
    try {
      await api.delete("/company/logo");
      await refresh();
      setForm((p) => ({ ...p, CompanyInformation_Logo: null }));
      setMsg({ type: "success", text: t("company.logoDeleted") });
    } catch (err) {
      setMsg({ type: "error", text: err.message || t("company.deleteFailed") });
    } finally {
      setLogoBusy(false);
    }
  };

  const logoSrc = companyLogoUrl(form.CompanyInformation_Logo || company?.CompanyInformation_Logo);

  return (
    <AppLayout title={t("pages.company")}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        <Card style={{ marginBottom: 24 }} padding="18px 22px">
          <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("company.logoSection")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {logoSrc && (
              <img src={logoSrc} alt={t("company.logoSection")} style={{ height: 64, maxWidth: 160, objectFit: "contain" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={handleLogoPick} />
              <Button size="sm" loading={logoBusy} onClick={() => fileRef.current?.click()}>
                📤 {t("company.uploadLogo")}
              </Button>
              {logoSrc && (
                <Button size="sm" variant="ghost" loading={logoBusy} onClick={handleLogoDelete} style={{ color: "var(--danger)" }}>
                  🗑 {t("company.deleteLogo")}
                </Button>
              )}
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>PNG, JPG, WebP — 2MB</span>
            </div>
          </div>
        </Card>

        <Card style={{ marginBottom: 24, background: "var(--bg-hover)" }} padding="18px 22px">
          <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("company.invoiceHeaderPreview")}
          </div>
          <div style={{
            padding     : "16px 20px",
            background  : "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border      : "1px dashed var(--border)",
            textAlign   : "center",
          }}>
            {logoSrc && (
              <img src={logoSrc} alt="" style={{ maxHeight: 56, objectFit: "contain", marginBottom: 10 }} />
            )}
            <div style={{ fontSize: "1.15rem", fontWeight: 900, color: "var(--text-primary)" }}>
              {form.CompanyInformation_Name || t("company.companyName")}
            </div>
            {form.CompanyInformation_Mobile && (
              <div style={{ fontSize: ".83rem", color: "var(--text-secondary)", marginTop: 4 }}>
                📞 {form.CompanyInformation_Mobile}
              </div>
            )}
            {form.CompanyInformation_Adress && (
              <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: 4 }}>
                📍 {form.CompanyInformation_Adress}
              </div>
            )}
            {form.CompanyInformation_TaxNo && (
              <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: 4 }}>
                🏛 {t("company.taxNo")}: {form.CompanyInformation_TaxNo}
              </div>
            )}
            {(form.CompanyInformation_Info1 || form.CompanyInformation_Info2) && (
              <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: 4 }}>
                {[form.CompanyInformation_Info1, form.CompanyInformation_Info2]
                  .filter(Boolean).join("  |  ")}
              </div>
            )}
          </div>
        </Card>

        <Card>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <span className="spinner" />
            </div>
          ) : (
            <form onSubmit={handleSave}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: ".85rem", fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>
                    {t("company.currency")}
                  </label>
                  <select
                    value={form.CurrencySymbol === "$" ? "$" : "د.ع"}
                    onChange={(e) => set("CurrencySymbol")(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                      background: "var(--bg-input)",
                      color: "var(--text-primary)",
                      fontSize: ".95rem",
                    }}
                  >
                    <option value="د.ع">{t("company.currencyIqd")}</option>
                    <option value="$">{t("company.currencyUsd")}</option>
                  </select>
                  <p style={{ margin: "6px 0 0", fontSize: ".72rem", color: "var(--text-muted)" }}>
                    {t("company.currencyHint")}
                  </p>
                </div>

                {FIELD_KEYS.map((f) => (
                  <Input
                    key={f.key}
                    label={t(f.labelKey)}
                    value={form[f.key] || ""}
                    onChange={set(f.key)}
                    placeholder={t(f.placeholderKey)}
                  />
                ))}
              </div>

              {msg && (
                <div
                  className={`alert alert-${msg.type === "success" ? "success" : "error"} animate-fade-in`}
                  style={{ marginTop: 20 }}
                >
                  {msg.text}
                </div>
              )}

              <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit" loading={saving} size="lg">
                  {t("company.save")}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
