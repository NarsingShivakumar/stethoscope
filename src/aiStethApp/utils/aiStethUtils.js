/**
  * Generate 6-character file number from patient ID
  */
export const generateFileNumberFromPatientId = (patientId) => {
    if (patientId) {
        // Generate random 6-character alphanumeric
        return generateRandomFileNumber();
    }

    // Extract last 6 alphanumeric characters from patientId
    // Example: PST150720250008 -> 250008
    const alphanumeric = patientId.replace(/[^A-Z0-9]/gi, '');
    const last6 = alphanumeric.slice(-6).toUpperCase();

    // Pad with random chars if less than 6
    if (last6.length < 6) {
        const remaining = 6 - last6.length;
        const randomChars = generateRandomFileNumber(remaining);
        return (last6 + randomChars).toUpperCase();
    }

    return last6;
};

/**
 * Generate random file number
 */
export const generateRandomFileNumber = (length = 6) => {
    const uuid = 'xxxxxxxx'.replace(/x/g, () => {
        return Math.floor(Math.random() * 36).toString(36).toUpperCase();
    });

    // Add timestamp for extra uniqueness
    const timestamp = Date.now().toString(36).toUpperCase();

    // Combine UUID + timestamp
    const combined = uuid + timestamp;

    // Extract random characters from combined string
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
        // Use combined string or random generation
        if (i < combined.length) {
            result += combined.charAt(Math.floor(Math.random() * combined.length));
        } else {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    console.log('result::', result);

    return result.toUpperCase();
};

/**
 * Convert timestamp to yyyy-mm-dd format
 */
export const convertTimestampToDate = (timestamp) => {
    if (!timestamp) return '1900-01-01';

    try {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error('Error converting timestamp:', error);
        return '1900-01-01';
    }
};
