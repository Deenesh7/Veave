import api from './api';

export const billingService = {
  getOverview: () => api.get('/billing'),
  changePlan: (plan) => api.post('/billing/change-plan', { plan }),
  createOrder: (plan) => api.post('/billing/create-order', { plan }),
  verifyPayment: (data) => api.post('/billing/verify-payment', data),
  createCreditOrder: (credits) => api.post('/billing/credits/create-order', { credits }),
  verifyCreditPayment: (data) => api.post('/billing/credits/verify-payment', data),
  getInvoices: () => api.get('/billing/invoices'),
};
