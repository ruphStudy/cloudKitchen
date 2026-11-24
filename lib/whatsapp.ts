import { formatPaise } from "@/lib/format";

/** https://wa.me/<number>?text=<message> (number: digits with country code). */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export interface OrderMessageInput {
  orderNo: string;
  name: string;
  day: string; // already formatted, e.g. "Saturday, 28 November"
  slot: string; // e.g. "12–1 PM"
  items: { quantity: number; name: string }[];
  totalPaise: number;
}

/** Message the customer sends us after paying. */
export function orderWhatsAppMessage(o: OrderMessageInput): string {
  return [
    `Hi! My order is confirmed ✅`,
    `Order: ${o.orderNo}`,
    `Name: ${o.name}`,
    `Pickup: ${o.day}, ${o.slot}`,
    `Items: ${o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}`,
    `Paid: ${formatPaise(o.totalPaise)}`,
  ].join("\n");
}

/** Message we send the customer asking for feedback. */
export function feedbackRequestMessage(name: string, orderNo: string, feedbackUrl: string): string {
  return `Hi ${name}! Thank you for your order ${orderNo} 🙏\nHow was it? It takes 20 seconds:\n${feedbackUrl}`;
}
