import { Delivery } from '../models/Delivery.js';

export const deliveryService = {
  /**
   * Retrieves all deliveries that are 'sent' and have expired (deleteAt <= current time)
   * @returns {Promise<Array>}
   */
  async getExpiredDeliveries() {
    return Delivery.find({
      status: 'sent',
      deleteAt: { $lte: new Date() }
    });
  },

  /**
   * Updates delivery record status
   * @param {string} deliveryId 
   * @param {string} status - 'deleted' or 'failed'
   * @param {string} [errorMessage] - optional error trace
   * @returns {Promise<object|null>}
   */
  async updateDeliveryStatus(deliveryId, status, errorMessage = null) {
    const updateData = { status };
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }
    return Delivery.findByIdAndUpdate(
      deliveryId,
      { $set: updateData },
      { new: true }
    );
  }
};
