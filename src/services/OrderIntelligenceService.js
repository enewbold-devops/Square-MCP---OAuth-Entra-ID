// Stateless, read-only aggregation over the Square Orders API. Results are intentionally computed
// for each MCP call and never retained by this server.
export class OrderIntelligenceService {
    static MAX_ORDERS = 1000;

    #squareContext;

    constructor(squareContext) {
        this.#squareContext = squareContext;
    }

    static assertPeriod(startAt, endAt) {
        const start = Date.parse(startAt);
        const end = Date.parse(endAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            throw new Error('period_start_at and period_end_at must be valid RFC 3339 timestamps, with end after start.');
        }
        if (end - start > 31 * 24 * 60 * 60 * 1000) {
            throw new Error('A single sales-intelligence request is limited to 31 days. Split longer comparisons into smaller periods.');
        }
    }

    async searchCompleted({ locationIds, startAt, endAt }) {
        OrderIntelligenceService.assertPeriod(startAt, endAt);
        const orders = [];
        let cursor;
        do {
            const page = await this.#squareContext.client.orders.search({
                locationIds,
                query: {
                    filter: {
                        stateFilter: { states: ['COMPLETED'] },
                        dateTimeFilter: { closedAt: { startAt, endAt } },
                    },
                    sort: { sortField: 'CLOSED_AT', sortOrder: 'ASC' },
                },
                limit: OrderIntelligenceService.MAX_ORDERS,
                cursor,
            });
            orders.push(...(page.orders ?? []));
            cursor = page.cursor;
        } while (cursor && orders.length < OrderIntelligenceService.MAX_ORDERS);

        if (cursor) {
            throw new Error(`Order search exceeds the ${OrderIntelligenceService.MAX_ORDERS}-order safety limit. Narrow the period or location.`);
        }
        return orders;
    }

    static moneyAmount(money) {
        return Number(money?.amount ?? 0);
    }

    static currency(orders) {
        return orders.find((order) => order.totalMoney?.currency)?.totalMoney?.currency ?? 'USD';
    }

    static summarize(orders) {
        const totalSalesCents = orders.reduce((total, order) => total + OrderIntelligenceService.moneyAmount(order.totalMoney), 0);
        const totalDiscountCents = orders.reduce((total, order) => total + OrderIntelligenceService.moneyAmount(order.totalDiscountMoney), 0);
        const totalTaxCents = orders.reduce((total, order) => total + OrderIntelligenceService.moneyAmount(order.totalTaxMoney), 0);
        const totalTipCents = orders.reduce((total, order) => total + OrderIntelligenceService.moneyAmount(order.totalTipMoney), 0);
        return {
            orderCount: orders.length,
            currency: OrderIntelligenceService.currency(orders),
            totalSalesCents,
            totalDiscountCents,
            totalTaxCents,
            totalTipCents,
            averageTicketCents: orders.length ? Math.round(totalSalesCents / orders.length) : 0,
        };
    }

    static summarizeByHour(orders, timeZone) {
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
        const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orderCount: 0, totalSalesCents: 0 }));
        for (const order of orders) {
            if (!order.closedAt) {
                continue;
            }
            const hour = Number(formatter.format(new Date(order.closedAt)));
            byHour[hour].orderCount += 1;
            byHour[hour].totalSalesCents += OrderIntelligenceService.moneyAmount(order.totalMoney);
        }
        return byHour;
    }

    static topItems(orders, maximum = 10) {
        const items = new Map();
        for (const order of orders) {
            for (const lineItem of order.lineItems ?? []) {
                const key = lineItem.catalogObjectId ?? lineItem.name ?? 'Unspecified item';
                const current = items.get(key) ?? {
                    catalogObjectId: lineItem.catalogObjectId ?? null,
                    name: lineItem.name ?? 'Unspecified item',
                    quantity: 0,
                    grossSalesCents: 0,
                };
                current.quantity += Number(lineItem.quantity ?? 0);
                current.grossSalesCents += OrderIntelligenceService.moneyAmount(lineItem.grossSalesMoney ?? lineItem.totalMoney);
                items.set(key, current);
            }
        }
        return [...items.values()].sort((left, right) => right.grossSalesCents - left.grossSalesCents).slice(0, maximum);
    }
}
