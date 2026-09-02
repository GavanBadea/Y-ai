// src/services/expiredService.js
import api from "@/services/api";

export const expiredService = {
  getAll     : (params) => api.get("/expired-stock",             { params }),
  getPending : ()       => api.get("/expired-stock/pending"),
  getSummary : ()       => api.get("/expired-stock/summary"),
  processAll : ()       => api.post("/expired-stock/process"),
  processOne : (id, d)  => api.post(`/expired-stock/process/${id}`, d),
};
