// Search the order list by customer name.

/** Orders whose customer name contains `query`. */
export function searchOrders(orders, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return orders;
  return orders.filter((order) => order.customer.toLowerCase().includes(needle));
}
