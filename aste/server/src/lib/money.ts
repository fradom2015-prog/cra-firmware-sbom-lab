// Importi interi in centesimi. Arrotondamento al centesimo più vicino.
export const feeOf = (amount: number, bps: number) => Math.round((amount * bps) / 10_000);

export function orderAmounts(item: number, shipping: number, buyerFeeBps: number, sellerFeeBps: number) {
  const buyerFee = feeOf(item, buyerFeeBps);
  const sellerFee = feeOf(item, sellerFeeBps);
  return {
    itemAmount: item,
    shippingAmount: shipping,
    buyerFee,
    sellerFee,
    totalAmount: item + shipping + buyerFee,
    sellerPayout: item + shipping - sellerFee,
  };
}

export const formatEuro = (cents: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
