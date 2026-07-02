import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Delivery } from './models/Delivery';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftchain';

const seedDeliveries = async () => {
  try {
    await mongoose.connect(MONGODB_URI);

    const delivery = {
      deliveryId: 'DEL-001',
      driverId: 'DRV-001',
      userId: 'USR-001',
      pickupCoordinates: {
        lat: 40.7128,
        lng: -74.0060,
        address: 'New York, NY',
      },
      dropoffCoordinates: {
        lat: 40.7580,
        lng: -73.9855,
        address: 'Times Square, NY',
      },
      status: 'pending',
    };

    await Delivery.deleteMany({});
    await Delivery.create(delivery);

    console.log('✅ Test delivery created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to seed data:', error);
    process.exit(1);
  }
};

seedDeliveries();
