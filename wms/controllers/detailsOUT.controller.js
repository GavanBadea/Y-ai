// controllers/detailsOUT.controller.js  —  جدول تفاصيل المبيعات DetailsOUT_tbl
const db = require("../db");

const getByInvoice = async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT d.*, m.MaterialName, m.Band
      FROM DetailsOUT_tbl d
      LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      WHERE d.id_NoFOUT=?`, [req.params.invoiceId]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getByInvoice };
