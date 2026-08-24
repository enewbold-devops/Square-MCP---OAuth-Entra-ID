// Ephemeral, request-scoped Square authorization context - never persisted.
export class SquareContext {
    merchantId;
    client;
    authorizedLocations;

    constructor({ merchantId, client, authorizedLocations }) {
        this.merchantId = merchantId;
        this.client = client;
        this.authorizedLocations = authorizedLocations ?? [];
    }

    // The model may request a location by name/id, but authorization is decided here - never delegated to the caller.
    requireAuthorizedLocation(locationIdOrName) {
        const needle = String(locationIdOrName).toLowerCase();
        const match = this.authorizedLocations.find(
            (location) => location.id === locationIdOrName || location.name?.toLowerCase() === needle
        );
        if (!match) {
            throw new Error(`Location "${locationIdOrName}" is not an authorized location for this Square connection.`);
        }
        return match;
    }
}
