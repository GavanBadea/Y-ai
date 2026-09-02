// controllers/detailsRetern.controller.js  —  DetailsRetern_tbl
const db = require("../db");

const getByReturn = async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT d.*, m.MaterialName, m.Band
      FROM DetailsRetern_tbl d
      LEFT JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
      WHERE d.id_NoFRetern=?`, [req.params.returnId]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getByReturn };
