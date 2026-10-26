import { create } from 'zustand';
import { billingService } from '../services/billingService';
import { useAuthStore } from './authStore';
import { loadRazorpayScript } from '../utils/razorpay';

export const useBillingStore = create((set, get) => ({
  overview: null,
  invoices: [],
  isLoading: false,
  isChangingPlan: false,
  isProcessingPayment: false,
  paymentSuccess: null,
  error: null,

  fetchOverview: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await billingService.getOverview();
      const data = res.data?.data || null;
      set({ overview: data, isLoading: false, lastUpdated: Date.now() });
      return data;
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Failed to fetch billing overview';
      set({ error: message, isLoading: false });
      return null;
    }
  },

  // Silent re-read of live usage (no spinner, no error banner). Used for polling and after anything that changes
  // usage, so Projects / Storage / Credits / Tokens follow the real data instead of a snapshot.
  lastUpdated: null,
  refreshOverview: async () => {
    if (!localStorage.getItem('veave_token')) return null;
    try {
      const res = await billingService.getOverview();
      const data = res.data?.data || null;
      if (data) set({ overview: data, lastUpdated: Date.now() });
      return data;
    } catch {
      return null;
    }
  },

  changePlan: async (planName) => {
    set({ isChangingPlan: true, error: null });
    try {
      const res = await billingService.changePlan(planName);
      const data = res.data?.data;

      // Update auth store with the new user data
      if (data?.user) {
        useAuthStore.getState().setUser(data.user);
      }

      // Refetch overview to get updated billing data
      const overviewRes = await billingService.getOverview();
      set({
        overview: overviewRes.data?.data || null,
        isChangingPlan: false,
      });

      return data;
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Failed to change plan';
      set({ error: message, isChangingPlan: false });
      throw err;
    }
  },

  /**
   * Secure checkout flow
   */
  startCheckout: async (planName) => {
    set({ isProcessingPayment: true, error: null, paymentSuccess: null });
    try {
      // 1. Create order on the backend
      const orderRes = await billingService.createOrder(planName);
      const orderData = orderRes.data?.data;

      if (!orderData) {
        throw new Error('Failed to create payment order');
      }

      const currentUser = useAuthStore.getState().user;

      const isScriptLoaded = await loadRazorpayScript();
      if (!isScriptLoaded || !window.Razorpay) {
        throw new Error('Could not load the payment checkout. Check your connection and try again.');
      }

      {
        // Open the payment checkout popup
        return new Promise((resolve, reject) => {
          const options = {
            key: orderData.keyId,
            amount: orderData.amount,
            currency: orderData.currency || 'INR',
            name: 'Veave AI',
            description: `${planName} Subscription`,
            order_id: orderData.orderId,
            prefill: {
              name: currentUser?.name || '',
              email: currentUser?.email || '',
            },
            theme: {
              color: '#18181b',
            },
            modal: {
              ondismiss: () => {
                set({ isProcessingPayment: false });
                resolve(null);
              },
            },
            handler: async (response) => {
              try {
                // Verify payment on backend
                const verifyRes = await billingService.verifyPayment({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  plan: planName,
                });

                const verifiedData = verifyRes.data?.data;
                if (verifiedData?.user) {
                  useAuthStore.getState().setUser(verifiedData.user);
                }

                await get().fetchOverview();
                await get().fetchInvoices();

                set({
                  isProcessingPayment: false,
                  paymentSuccess: {
                    plan: planName,
                    invoice: verifiedData?.payment,
                  },
                });

                resolve(verifiedData);
              } catch (verifyErr) {
                const msg = verifyErr.response?.data?.error?.message || 'Payment verification failed';
                set({ error: msg, isProcessingPayment: false });
                reject(verifyErr);
              }
            },
          };

          const rzp = new window.Razorpay(options);
          rzp.on('payment.failed', (failResp) => {
            set({
              error: failResp.error?.description || 'Payment was unsuccessful',
              isProcessingPayment: false,
            });
            reject(new Error(failResp.error?.description));
          });
          rzp.open();
        });
      }
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Payment initiation failed';
      set({ error: message, isProcessingPayment: false });
      throw err;
    }
  },

  fetchInvoices: async () => {
    try {
      const res = await billingService.getInvoices();
      set({ invoices: res.data?.data || [] });
    } catch (err) {
      console.warn('Failed to fetch invoices:', err);
    }
  },

  clearPaymentSuccess: () => set({ paymentSuccess: null }),
  clearError: () => set({ error: null }),
}));
