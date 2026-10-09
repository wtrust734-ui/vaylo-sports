/** Contract for a future native Play plugin. No payment SDK is installed here. */
export interface PlayPurchase {
  productId: string;
  packageName: string;
  /** Google's purchase token, rather than the order id. */
  purchaseToken: string;
}

export type PlayPurchaseOutcome =
  | { cancelled: true }
  | { cancelled: false; purchase: PlayPurchase };

export interface PlayBillingAdapter {
  purchase(productId: string): Promise<PlayPurchaseOutcome>;
  /** Return purchases awaiting delivery or store confirmation. */
  restore(): Promise<PlayPurchase[]>;
  /** Consume or acknowledge only after the server has granted the purchase. */
  finish(purchase: PlayPurchase): Promise<void>;
}

let adapter: PlayBillingAdapter | null = null;

/** A future native integration installs its adapter during application startup. */
export function registerPlayBillingAdapter(value: PlayBillingAdapter | null): void {
  adapter = value;
}

export function getPlayBillingAdapter(): PlayBillingAdapter | null {
  return adapter;
}
