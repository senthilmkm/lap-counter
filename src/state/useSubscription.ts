import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { PurchasesPackage } from 'react-native-purchases';
import {
  isUserPremium,
  getActiveSubscriptionTier,
  getSubscriptionPackages,
  purchaseSubscription,
  restorePurchases,
  initBilling
} from '../services/billing';
import { triggerSuccessHaptic, triggerFailureHaptic } from '../services/haptics';

export function useSubscription() {
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [subTier, setSubTier] = useState<'free' | 'monthly' | 'annual'>('free');
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const checkEntitlements = useCallback(async () => {
    try {
      const activeTier = await getActiveSubscriptionTier();
      setSubTier(activeTier);
      setIsPremium(activeTier !== 'free');
      
      // Load packages if they haven't been fetched yet
      if (activeTier === 'free' && packages.length === 0) {
        const available = await getSubscriptionPackages();
        setPackages(available);
      }
    } catch (e) {
      console.warn('Error checking entitlements:', e);
    } finally {
      setLoading(false);
    }
  }, [packages.length]);

  // Initial load
  useEffect(() => {
    // Initialize billing client asynchronously
    initBilling().then(() => {
      checkEntitlements();
    });

    // Refresh when app comes back to foreground
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkEntitlements();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [checkEntitlements]);

  const buyPackage = async (pkg: PurchasesPackage): Promise<boolean> => {
    setLoading(true);
    const success = await purchaseSubscription(pkg);
    if (success) {
      const activeTier = await getActiveSubscriptionTier();
      setSubTier(activeTier);
      setIsPremium(activeTier !== 'free');
      triggerSuccessHaptic();
    } else {
      triggerFailureHaptic();
    }
    setLoading(false);
    return success;
  };

  const restore = async (): Promise<boolean> => {
    setLoading(true);
    const success = await restorePurchases();
    if (success) {
      const activeTier = await getActiveSubscriptionTier();
      setSubTier(activeTier);
      setIsPremium(activeTier !== 'free');
      triggerSuccessHaptic();
    } else {
      triggerFailureHaptic();
    }
    setLoading(false);
    return success;
  };

  return {
    isPremium,
    subTier,
    packages,
    loading,
    refreshSubscription: checkEntitlements,
    buyPackage,
    restore,
    // Provide a setter for local tests/simulations so the user can easily toggle premium mode
    setIsPremium,
    setSubTier,
  };
}
export type SubscriptionState = ReturnType<typeof useSubscription>;
