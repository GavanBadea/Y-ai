// src/pages/settings/GuidesPage.jsx — الشروحات (إدارة النظام)
import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import { useCompany } from "@/context/CompanyContext";
import { openReportPrint } from "@/utils/invoicePrint";

const TABS = [
  { id: "excel", label: "📊 شرح ملفات Excel للرفع" },
  { id: "accounting", label: "📒 شرح قسم المحاسبة" },
];

const sectionTitle = {
  fontSize: "1rem",
  fontWeight: 800,
  color: "var(--text-primary)",
  marginBottom: 10,
  marginTop: 20,
  paddingBottom: 6,
  borderBottom: "2px solid var(--accent)",
};

const subTitle = {
  fontSize: ".88rem",
  fontWeight: 700,
  color: "var(--accent)",
  marginBottom: 8,
  marginTop: 14,
};

const listSt = {
  margin: "0 0 12px",
  paddingRight: 22,
  lineHeight: 1.75,
  color: "var(--text-secondary)",
  fontSize: ".88rem",
};

const tableSt = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: ".84rem",
  marginBottom: 16,
};

const thSt = {
  padding: "9px 12px",
  textAlign: "right",
  color: "var(--text-muted)",
  fontWeight: 700,
  fontSize: ".68rem",
  textTransform: "uppercase",
  background: "var(--bg-surface)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdSt = {
  padding: "9px 12px",
  borderBottom: "1px solid var(--border-subtle)",
};

const cardSt = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "14px 18px",
  marginTop: 12,
};

const tabBtn = (active) => ({
  padding: "10px 18px",
  background: active ? "var(--bg-card)" : "transparent",
  border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: active ? "var(--accent)" : "var(--text-secondary)",
  fontWeight: active ? 800 : 600,
  fontSize: ".86rem",
  cursor: "pointer",
  fontFamily: "var(--font-main)",
});

function GuideTable({ headers, rows }) {
  return (
    <table style={tableSt}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} style={thSt}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} style={tdSt}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExcelImportGuide() {
  return (
    <div style={{ maxWidth: 960, lineHeight: 1.8, color: "var(--text-secondary)", fontSize: ".88rem" }}>
      <p>
        هذا الشرح يوضح كيفية ترتيب ملفات Excel عند الانتقال من برنامج قديم إلى النظام الحالي.
        يُفضّل استيراد كل قسم على حدة بالترتيب أدناه.
      </p>

      <div style={sectionTitle}>ترتيب الاستيراد (مهم جداً)</div>
      <GuideTable
        headers={["الخطوة", "القسم", "أين في النظام"]}
        rows={[
          ["1", "المناطق", "الجداول المرجعية → المناطق"],
          ["2", "الأصناف", "الجداول المرجعية → الأصناف"],
          ["3", "الأنواع", "الجداول المرجعية → الأنواع"],
          ["4", "الزبائن والموردين", "الزبائن - الموردون"],
          ["5", "المواد", "المواد"],
        ]}
      />

      <div style={sectionTitle}>قواعد عامة لكل ملفات Excel</div>
      <ul style={listSt}>
        <li>الصف الأول = عناوين الأعمدة (بالضبط كما في الجداول أدناه).</li>
        <li>البيانات من الصف الثاني فصاعداً.</li>
        <li>لا صفوف فارغة في منتصف الملف.</li>
        <li>الأرقام بدون فواصل آلاف (مثال: <code>15000</code> وليس <code>15,000</code>).</li>
        <li>الأسماء النصية (صنف، نوع، منطقة) يُفضّل أن تكون مطابقة حرفياً بين الملفات.</li>
      </ul>

      <div style={sectionTitle}>1) المناطق</div>
      <p><strong>المكان:</strong> الجداول المرجعية → تبويب المناطق</p>
      <GuideTable
        headers={["اسم_المنطقة"]}
        rows={[["الكرادة"], ["المنصور"], ["دهوك"]]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> اسم_المنطقة</li>
        <li>يُفضّل اسم فريد لكل منطقة.</li>
      </ul>

      <div style={sectionTitle}>2) الأصناف</div>
      <p><strong>المكان:</strong> الجداول المرجعية → تبويب الأصناف</p>
      <GuideTable
        headers={["اسم_الصنف"]}
        rows={[["مواد غذائية"], ["مستلزمات"], ["ألبان"]]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> اسم_الصنف</li>
      </ul>

      <div style={sectionTitle}>3) الأنواع</div>
      <p><strong>المكان:</strong> الجداول المرجعية → تبويب الأنواع</p>
      <GuideTable
        headers={["اسم_النوع"]}
        rows={[["طازج"], ["معلّب"], ["مجمّد"]]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> اسم_النوع</li>
      </ul>

      <div style={sectionTitle}>4) الزبائن والموردين</div>
      <p><strong>المكان:</strong> الزبائن - الموردون (تبويبان منفصلان)</p>

      <div style={subTitle}>ورقة الزبائن</div>
      <GuideTable
        headers={["اسم_الزبون", "الموبايل", "العنوان", "المنطقة", "حد_الائتمان"]}
        rows={[
          ["أحمد محمد", "07701234567", "شارع 60", "الكرادة", "0"],
          ["شركة النور", "07509876543", "المنطقة الصناعية", "دهوك", "500000"],
        ]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> اسم_الزبون، الموبايل، العنوان</li>
        <li><strong>اختياري:</strong> المنطقة (يجب أن تكون مستوردة مسبقاً في ملف المناطق)</li>
        <li><strong>اختياري:</strong> حد_الائتمان (0 إن لم يوجد)</li>
      </ul>

      <div style={subTitle}>ورقة الموردين</div>
      <GuideTable
        headers={["اسم_المورد", "الموبايل", "العنوان"]}
        rows={[
          ["مورد بغداد", "07801112233", "سوق الشورجة"],
          ["شركة الاستيراد", "07505556677", "المنطقة الحرة"],
        ]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> الموبايل، العنوان</li>
        <li><strong>مستحسن:</strong> اسم_المورد</li>
      </ul>

      <div style={sectionTitle}>5) المواد</div>
      <p><strong>المكان:</strong> المواد</p>
      <GuideTable
        headers={[
          "اسم_المادة", "الباركود", "الوحدة", "الصنف", "النوع",
          "سعر_الشراء", "سعر_بيع1", "سعر_بيع2", "سعر_بيع3", "سعر_بيع4", "سعر_بيع5", "كمية_افتتاحية",
        ]}
        rows={[
          [
            "حليب المراعي 1لتر", "6281001234567", "كارتون", "مواد غذائية", "معلّب",
            "12000", "14000", "13500", "0", "0", "0", "50",
          ],
          [
            "زيت عافية 4لتر", "6281009876543", "قطعة", "مواد غذائية", "معلّب",
            "18000", "21000", "0", "0", "0", "0", "120",
          ],
        ]}
      />
      <ul style={listSt}>
        <li><strong>إلزامي:</strong> اسم_المادة، الوحدة (كارتون، قطعة، كيلو، لتر، باكيت، كرتونة، علبة، حبة، برميل، طن)</li>
        <li><strong>مستحسن:</strong> الباركود (فريد — إن تُرك فارغاً يمكن توليده تلقائياً)</li>
        <li><strong>مستحسن:</strong> الصنف والنوع كنص (يجب استيرادهما مسبقاً)</li>
        <li><strong>اختياري:</strong> أسعار الشراء والبيع 1–5</li>
        <li><strong>اختياري:</strong> كمية_افتتاحية (رصيد أول المدة)</li>
      </ul>

      <div style={sectionTitle}>ملاحظات لتجنب المشاكل</div>
      <ul style={listSt}>
        <li>لا تستورد المواد قبل الأصناف والأنواع.</li>
        <li>لا تستورد الزبائن قبل المناطق إن كنت تستخدم عمود المنطقة.</li>
        <li>الباركود المكرر يرفض إضافة المادة — راجع التكرار قبل الرفع.</li>
        <li>أرصدة الزبائن/الموردين الافتتاحية ليست في جداول التعريف؛ تُسجَّل لاحقاً من قسم الديون إن احتجتها.</li>
        <li>المخزون الافتتاحي للمواد يُفضّل أن يكون في عمود كمية_افتتاحية عند الاستيراد.</li>
      </ul>

      <div style={cardSt}>
        <strong>الخلاصة</strong>
        <p style={{ margin: "8px 0 0" }}>
          عند الانتقال من برنامج قديم: صدّر البيانات الخمسة، رتّبها حسب الجداول أعلاه،
          ثم ارفعها بالترتيب: مناطق → أصناف → أنواع → زبائن وموردين → مواد.
          لكل قسم ملف Excel مستقل بعناوين واضحة في الصف الأول.
        </p>
      </div>
    </div>
  );
}

function AccountingGuide() {
  const topicRows = (items) => items.map((name) => (
    <tr key={name}><td style={tdSt}>{name}</td></tr>
  ));

  const sections = [
    ["1 الموجودات", "الاندثار + حركات البرنامج (مخزون، ذمم، صندوق)"],
    ["2 المطلوبات وحقوق الملكية", "رأس المال + ديون الموردين + صافي الربح (محسوب)"],
    ["3 المصروفات", "المصاريف + تكلفة البضاعة المباعة + الاندثار (37)"],
    ["4 الإيرادات", "فواتير المبيعات (صافي بعد خصم ومرتجع)"],
  ];

  return (
    <div style={{ maxWidth: 900, lineHeight: 1.8, color: "var(--text-secondary)", fontSize: ".88rem" }}>
      <p>
        هذا الشرح يطابق تبويب <strong>الشرح</strong> في قسم المحاسبة — يوضح مصادر البيانات
        في الشجرة المحاسبية وكيفية توزيع المصاريف على الحسابات 31 و 32 و 33.
      </p>

      <div style={sectionTitle}>ملخص سريع للأقسام الأربعة</div>
      <table style={tableSt}>
        <thead>
          <tr>
            <th style={thSt}>القسم</th>
            <th style={thSt}>مصدر البيانات</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(([sec, src]) => (
            <tr key={sec}>
              <td style={{ ...tdSt, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>{sec}</td>
              <td style={tdSt}>{src}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={sectionTitle}>توزيع وإدخال المصاريف</div>
      <p>عند إضافة موضوع في <strong>المصاريف → الجزء الأول</strong>، اختر الحساب كالتالي:</p>

      <div style={subTitle}>حساب 31 — الرواتب والأجور (مصاريف موظفين)</div>
      <table style={tableSt}>
        <thead><tr><th style={thSt}>اسم الموضوع المقترح</th></tr></thead>
        <tbody>{topicRows([
          "رواتب الموظفين", "أجور العمال اليومية", "مكافآت وحوافز", "بدل سكن / مواصلات",
          "تأمينات اجتماعية", "علاوات نهاية الخدمة (إذا صُرفت شهرياً)",
        ])}</tbody>
      </table>

      <div style={subTitle}>حساب 32 — المستلزمات السلعية (مرتبطة بالبضاعة والمستودع)</div>
      <table style={tableSt}>
        <thead><tr><th style={thSt}>اسم الموضوع المقترح</th></tr></thead>
        <tbody>{topicRows([
          "قرطاسية ومستلزمات مكتب", "أكياس وتعبئة وتغليف", "مواد تنظيف المستودع",
          "قرطاسية نقطة البيع", "قرطاسية وطباعة فواتير", "صيانة بسيطة للمستودع",
          "وقود توصيل البضاعة", "عمولات مندوبين (إن لم تُسجّل في الفاتورة)", "مصاريف شحن داخلي",
        ])}</tbody>
      </table>

      <div style={subTitle}>حساب 33 — المستلزمات الخدمية (إيجارات وفواتير وخدمات ثابتة)</div>
      <table style={tableSt}>
        <thead><tr><th style={thSt}>اسم الموضوع المقترح</th></tr></thead>
        <tbody>{topicRows([
          "إيجار المستودع / المحل", "إيجار المكتب", "فاتورة الكهرباء", "فاتورة الماء",
          "إنترنت وهاتف", "اشتراك برنامج / سيرفر", "أمن وحراسة", "محاسب / مدقق خارجي",
          "ضرائب ورسوم حكومية", "تأمين", "إعلان وتسويق", "صيانة تكييف وكهرباء المبنى",
        ])}</tbody>
      </table>

      <div style={cardSt}>
        <strong>قاعدة بسيطة:</strong>
        <ul style={listSt}>
          <li><strong>31</strong> = راتب لشخص يعمل عندك</li>
          <li><strong>32</strong> = شيء يُستهلك مع البضاعة أو المستودع</li>
          <li><strong>33</strong> = خدمة أو إيجار أو فاتورة شهرية</li>
        </ul>
        <span style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>
          إذا لم تختر حساباً عند الإنشاء، النظام يضع الموضوع افتراضياً على <strong>32</strong>.
        </span>
      </div>
    </div>
  );
}

function printGuideContent({ title, contentId, company }) {
  const el = document.getElementById(contentId);
  if (!el) return alert("تعذّر الطباعة");
  openReportPrint({
    title,
    subtitle: "دليل استخدام النظام — إدارة النظام / الشروحات",
    company: company || {},
    tableHtml: `<div style="font-size:13px;line-height:1.75;text-align:right;direction:rtl">${el.innerHTML}</div>`,
  });
}

export default function GuidesPage() {
  const { company } = useCompany();
  const [tab, setTab] = useState("excel");

  const printCurrent = () => {
    if (tab === "excel") {
      printGuideContent({
        title: "شرح ملفات Excel للرفع",
        contentId: "guide-excel-print",
        company,
      });
    } else {
      printGuideContent({
        title: "شرح قسم المحاسبة",
        contentId: "guide-accounting-print",
        company,
      });
    }
  };

  return (
    <AppLayout
      title="الشروحات"
      actions={
        <Button variant="ghost" size="sm" onClick={printCurrent}>
          🖨 طباعة
        </Button>
      }
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} style={tabBtn(tab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div id="guide-excel-print" style={{ display: tab === "excel" ? "block" : "none" }}>
        <ExcelImportGuide />
      </div>
      <div id="guide-accounting-print" style={{ display: tab === "accounting" ? "block" : "none" }}>
        <AccountingGuide />
      </div>
    </AppLayout>
  );
}
