import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

export default function ExitConfirmModal({ onConfirm, onCancel }) {
  return (
    <Modal
      title="تسجيل الخروج مطلوب"
      onClose={onCancel}
      width={440}
    >
      <div style={{ padding: "8px 4px 4px" }}>
        <p style={{
          color: "var(--text-secondary)",
          fontSize: ".92rem",
          lineHeight: 1.7,
          marginBottom: 20,
        }}>
          لم يتم تسجيل الخروج بعد.
          <br />
          يجب تسجيل الخروج بالفعل قبل إغلاق البرنامج من المتصفح.
          <br />
          اضغط الزر أدناه لتسجيل الخروج وإيقاف الخادم فوراً.
        </p>

        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <Button fullWidth size="lg" onClick={onConfirm}>
            تسجيل الخروج وإغلاق البرنامج
          </Button>
          <Button fullWidth variant="ghost" onClick={onCancel}>
            متابعة العمل
          </Button>
        </div>
      </div>
    </Modal>
  );
}
