/** شرط SQL: هل طريقة الدفع آجل (غير نقدي)؟ */
const DEFERRED_PAY_SQL = `(
  pt.PayTypeName IN ('آجل','اجل')
  OR LOWER(COALESCE(pt.PayTypeName,'')) IN ('deferred','credit')
)`;

const SALE_INVOICE_AMT = `ROUND(
  COALESCE((
    SELECT SUM(d.AmountOUT * d.PriceOUT)
    FROM DetailsOUT_tbl d WHERE d.id_NoFOUT = f.id_NoFOUT
  ), 0) - f.Dis_FOUT + COALESCE(f.Add_FOUT, 0)
, 0)`;

const PURCHASE_INVOICE_AMT = `ROUND(
  COALESCE((
    SELECT SUM(d.AmountIN * d.PriceIN)
    FROM DetailsIN_tbl d WHERE d.id_NoFIN = f.id_NoFIN
  ), 0) + COALESCE(f.Trans, 0) + COALESCE(f.Customs, 0) + COALESCE(f.Porter, 0)
    + COALESCE(f.SGS, 0) + COALESCE(f.ExportRelease, 0) + COALESCE(f.VehicleManifest, 0)
    - COALESCE(f.Dis_FIN, 0)
, 0)`;

module.exports = {
  DEFERRED_PAY_SQL,
  SALE_INVOICE_AMT,
  PURCHASE_INVOICE_AMT,
};
