import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';

// RevenueCat public API keys (standard placeholder credentials)
const REVENUECAT_API_KEY_IOS = 'goog_placeholder_ios_api_key';
const REVENUECAT_API_KEY_ANDROID = 'goog_placeholder_android_api_key';

const ENTITLEMENT_PREMIUM = 'premium';

let isInitialized = false;

/**
 * Initializes the RevenueCat Purchases client.
 * Securely handles offline caches and maps keys for the correct operating system.
 */
export async function initBilling(): Promise<void> {
  if (isInitialized) return;

  // Set debug logs in development mode
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
  
  try {
    await Purchases.configure({ apiKey });
    isInitialized = true;
  } catch (error) {
    console.warn('RevenueCat failed to initialize:', error);
  }
}

/**
 * Queries the active entitlements of the user to check if they have premium.
 * If offline, this checks cached settings securely.
 */
export async function isUserPremium(): Promise<boolean> {
  try {
    await initBilling();
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
  } catch (error) {
    console.warn('Failed to query entitlement status:', error);
    return false;
  }
}

/**
 * Retrieves available purchase packages (Monthly, Annual).
 */
export async function getSubscriptionPackages(): Promise<PurchasesPackage[]> {
  try {
    await initBilling();
    const offerings = await Purchases.getOfferings();
    if (offerings.current && offerings.current.availablePackages.length > 0) {
      return offerings.current.availablePackages;
    }
    return [];
  } catch (error) {
    console.warn('Failed to get subscription offerings:', error);
    return [];
  }
}

/**
 * Launches the purchase flow for a package.
 * Returns true if the purchase succeeded and premium entitlement is active.
 */
export async function purchaseSubscription(pkg: PurchasesPackage): Promise<boolean> {
  try {
    await initBilling();
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
  } catch (error) {
    // Handle cancel or payment errors
    if ((error as any).userCancelled) {
      console.log('User cancelled purchase.');
    } else {
      console.warn('Purchase subscription error:', error);
    }
    return false;
  }
}

/**
 * Restores past transactions and returns true if the entitlement is active.
 */
export async function restorePurchases(): Promise<boolean> {
  try {
    await initBilling();
    const customerInfo = await Purchases.restorePurchases();
    return customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
  } catch (error) {
    console.warn('Failed to restore purchases:', error);
    return false;
  }
}
