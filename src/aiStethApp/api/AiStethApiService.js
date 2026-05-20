// src/aiStethApp/api/AiStethApiService.js
import axios from 'axios';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';

/**
 *  AISTETH CREDENTIALS CONFIGURATION
 */
const AISTETH_CREDENTIALS = {
  TESTING: {
    tenantId: '045fbd62-0e1c-4c1e-b27d-f8693704d87a',
    keySecret: '60eab1b9-c7c9-4e41-84c2-1763d6e7458d',
    keyId: 'aisteth-test-8cb2c9ed-ab11-45db-842c-5c73a7b723bf',
  },
  PRODUCTION: {
    tenantId: '045fbd62-0e1c-4c1e-b27d-f8693704d87a',
    keySecret: '60eab1b9-c7c9-4e41-84c2-1763d6e7458d',
    keyId: 'aisteth-live-8cb2c9ed-ab11-45db-842c-5c73a7b723bf',
  },
};

const getCredentials = (customCredentials = null) => {
  if (customCredentials) {
    return {
      tenantId: customCredentials.tenantId,
      keySecret: customCredentials.keySecret,
      keyId: customCredentials.keyId,
      isTesting: customCredentials.isTesting !== undefined
        ? customCredentials.isTesting
        : APP_CONFIG.USE_TESTING_ENVIRONMENT,
    };
  }

  const envCredentials = APP_CONFIG.USE_TESTING_ENVIRONMENT
    ? AISTETH_CREDENTIALS.TESTING
    : AISTETH_CREDENTIALS.PRODUCTION;

  return {
    ...envCredentials,
    isTesting: APP_CONFIG.USE_TESTING_ENVIRONMENT,
  };
};

const getBaseUrl = (isTesting) => {
  return isTesting
    ? 'https://developer.aisteth.com/api-local'
    : 'https://developer.aisteth.com/api';
};

const createAxiosInstance = (credentials) => {
  const baseUrl = getBaseUrl(credentials.isTesting);

  debugLog(`[AiSteth] Environment: ${credentials.isTesting ? 'TESTING' : 'PRODUCTION'}`);
  debugLog(`[AiSteth] Base URL: ${baseUrl}`);

  const axiosInstance = axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-tenant-id': credentials.tenantId,
      'x-key-secret': credentials.keySecret,
      'x-key-id': credentials.keyId,
    },
  });

  axiosInstance.interceptors.request.use(
    (config) => {
      debugLog('[AiSteth] API Request:', config.method.toUpperCase(), config.url);
      return config;
    },
    (error) => {
      debugError('[AiSteth] Request error:', error);
      return Promise.reject(error);
    }
  );

  axiosInstance.interceptors.response.use(
    (response) => {
      debugLog('[AiSteth] API Response:', response.status, response.config.url);
      return response;
    },
    (error) => {
      if (error.response) {
        debugError('[AiSteth] Response error:', error.response.status, error.response.data);
      } else if (error.request) {
        debugError('[AiSteth] Network error, no response received:', error.request);
      } else {
        debugError('[AiSteth] Error setting up request:', error.message);
      }
      return Promise.reject(error);
    }
  );

  return axiosInstance;
};

const credentials = getCredentials();
const axiosInstance = createAxiosInstance(credentials);

const formatContactArray = (value, type = 'PERSONAL') => {
  if (!value || value === '') {
    return [];
  }
  return [{ type, value }];
};

const getUserFriendlyMessage = (code) => {
  const messages = {
    NETWORK_ERROR: 'Please check your internet connection and try again',
    API_ERROR: 'Unable to connect to server. Please try again',
    CREATE_PATIENT_ERROR: 'Unable to create patient. Please try again',
    GET_PATIENTS_ERROR: 'Unable to fetch patient list. Please try again',
    GET_ANALYSIS_ERROR: 'Unable to fetch analysis. Please try again',
    GET_VISUALIZATION_ERROR: 'Unable to fetch visualization. Please try again',
    GET_AUDIO_ERROR: 'Unable to fetch audio. Please try again',
    UPLOAD_ERROR: 'Unable to upload file. Please try again',
    CREATE_PHR_ERROR: 'Unable to create PHR. Please try again',
    PARSE_ERROR: 'Unable to process response. Please try again',
  };
  return messages[code] || 'Something went wrong. Please try again';
};

const handleError = (error) => {
  if (error.response) {
    return {
      code: 'API_ERROR',
      message: error.response.data?.Message || error.message,
      status: error.response.status,
      userMessage: getUserFriendlyMessage('API_ERROR'),
      details: error.response.data,
    };
  } else if (error.request) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Network request failed',
      userMessage: getUserFriendlyMessage('NETWORK_ERROR'),
    };
  } else {
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error occurred',
      userMessage: getUserFriendlyMessage('UNKNOWN_ERROR'),
    };
  }
};

export const generateFileNumber = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const getCurrentConfig = () => {
  return {
    environment: credentials.isTesting ? 'TESTING' : 'PRODUCTION',
    baseUrl: getBaseUrl(credentials.isTesting),
    tenantId: credentials.tenantId.substring(0, 8) + '...',
    hasKeySecret: !!credentials.keySecret,
    hasKeyId: !!credentials.keyId,
  };
};

export const createPatient = async (patientData) => {
  try {
    debugLog('[AiSteth] Creating patient via API:', patientData);

    const payload = {
      first_name: patientData.firstName || patientData.fileNumber,
      last_name: patientData.lastName || '',
      file_number: patientData.fileNumber,
      age: patientData.age || '',
      gender: patientData.gender || '',
      date_of_birth: patientData.dateOfBirth || '1900-01-01',
      document_id: [],
      email: formatContactArray(patientData.email, 'PERSONAL'),
      phone: formatContactArray(patientData.phone, 'PERSONAL'),
    };

    const response = await axiosInstance.post('/user', payload, {
      headers: {
        'x-record-type': 'patient',
        'x-op': 'create-user',
      },
    });

    debugLog('[AiSteth] Patient created successfully:', response.data);

    return {
      success: true,
      code: response.data.Code,
      message: response.data.Message,
      uniqueId: response.data.Data.unique_id,
      fileNumber: response.data.Data.file_number,
      firstName: response.data.Data.first_name,
      lastName: response.data.Data.last_name,
      gender: response.data.Data.gender,
      dateOfBirth: response.data.Data.date_of_birth,
      rawData: response.data.Data,
    };
  } catch (error) {
    debugError('[AiSteth] Create patient error:', error);
    throw handleError(error);
  }
};

export const getPatientList = async (from = 0, size = 20, q = '') => {
  try {
    debugLog('[AiSteth] Fetching patient list:', { from, size, q });

    const response = await axiosInstance.get('/user', {
      params: { from, size, q },
      headers: {
        'x-record-type': 'patient',
        'x-op': 'search-users',
      },
    });

    debugLog('[AiSteth] Patient list fetched:', response.data);
    return response.data;
  } catch (error) {
    debugError('[AiSteth] Get patient list error:', error);
    throw handleError(error);
  }
};

export const uploadAudioFile = async (fileName, patientUniqueId, filePath) => {
  try {
    debugLog('[AiSteth] Uploading audio file:', { fileName, patientUniqueId, filePath });

    const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    const baseUrl = getBaseUrl(credentials.isTesting);
    const url = `${baseUrl}/file/${fileName}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'x-op': 'upload-phr-file',
        'x-tenant-id': credentials.tenantId,
        'x-key-secret': credentials.keySecret,
        'x-key-id': credentials.keyId,
        'x-record-type': 'examinations~heart',
        'patient-unique-id': patientUniqueId,
        'x-client': 'mobile',
      },
      body: {
        uri,
        type: 'audio/wav',
        name: fileName,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      debugError('[AiSteth] Upload error status:', response.status, text);
      throw {
        response: {
          status: response.status,
          data: text ? JSON.parse(text) : { Message: 'Upload failed' },
        },
      };
    }

    const data = await response.json();
    debugLog('[AiSteth] Audio file uploaded:', data);

    return {
      success: true,
      originalFileName: data.OriginalFileName,
      savedAs: data.SavedAs,
      message: data.Message,
      rawData: data,
    };
  } catch (error) {
    debugError('[AiSteth] Upload audio file error:', error);
    throw handleError(error);
  }
};

export const createPHR = async (phrData) => {
  try {
    debugLog('[AiSteth] Creating PHR:', phrData);

    const payload = {
      file_uploads: [
        {
          file_type: 'audio',
          title: phrData.originalFileName,
          file_name: phrData.savedFileName,
          description: phrData.description || '',
        },
      ],
      info_type_key: 'examinations~heart',
      form_data: [],
      notes: phrData.notes || '',
      patient_unique_id: phrData.patientUniqueId,
    };

    const response = await axiosInstance.post('/create_phr', payload, {
      headers: {
        'x-op': 'create-phr',
      },
    });

    debugLog('[AiSteth] PHR created:', response.data);
    return {
      success: true,
      phrId: response.data.ID,
      message: response.data.Message,
      rawData: response.data._source,
    };
  } catch (error) {
    debugError('[AiSteth] Create PHR error:', error);
    throw handleError(error);
  }
};

export const getPHRList = async (patientId, from = 0, size = 10) => {
  try {
    debugLog('[AiSteth] Fetching PHR list:', { patientId, from, size });

    const response = await axiosInstance.get('/get_phr', {
      params: {
        from,
        pid: patientId,
        q: 'examinations',
        size,
      },
      headers: {
        'x-op': 'search-phrs',
      },
    });

    debugLog('[AiSteth] PHR list fetched:', response.data);
    return response.data;
  } catch (error) {
    debugError('[AiSteth] Get PHR list error:', error);
    throw handleError(error);
  }
};

export const getAIAnalysis = async (patientUniqueId, fileName) => {
  try {
    debugLog('[AiSteth] Fetching AI analysis:', { patientUniqueId, fileName });

    const response = await axiosInstance.get(`/phr/${patientUniqueId}/${fileName}`, {
      headers: {
        'x-op': 'get-phr-by-file_name',
        'x-record-type': 'ai_analysis~heart',
      },
    });

    debugLog('[AiSteth] AI analysis fetched:', response.data);
    return response.data;
  } catch (error) {
    debugError('[AiSteth] Get AI analysis error:', error);
    throw handleError(error);
  }
};

export const getVisualizationUrl = async (fileName, patientUniqueId, isDenoised = false) => {
  try {
    debugLog('[AiSteth] Fetching visualization:', { fileName, isDenoised });

    const whichVis = isDenoised ? '5seconds_visualization_denoised' : '5seconds_visualization';

    const response = await axiosInstance.get(`/file/${fileName}`, {
      headers: {
        'x-which-vis': whichVis,
        'x-op': 'get-vis-file',
        'patient-unique-id': patientUniqueId,
      },
    });

    debugLog('[AiSteth] Visualization URL fetched:', response.data);
    return response.data;
  } catch (error) {
    debugError('[AiSteth] Get visualization error:', error);
    throw handleError(error);
  }
};

export const getAudioUrl = async (fileName, patientUniqueId, isDenoised = false) => {
  try {
    debugLog('[AiSteth] Fetching audio URL:', { fileName, isDenoised });

    const whichAudio = isDenoised ? 'denoised' : 'gt';

    const response = await axiosInstance.get(`/file/${fileName}`, {
      headers: {
        'x-which-audio': whichAudio,
        'x-op': 'get-phr-file',
        'patient-unique-id': patientUniqueId,
      },
    });

    debugLog('[AiSteth] Audio URL fetched:', response.data);
    return response.data;
  } catch (error) {
    debugError('[AiSteth] Get audio URL error:', error);
    throw handleError(error);
  }
};

const aiStethService = {
  createPatient,
  getPatientList,
  uploadAudioFile,
  createPHR,
  getPHRList,
  getAIAnalysis,
  getVisualizationUrl,
  getAudioUrl,
  generateFileNumber,
  getCurrentConfig,
};

export default aiStethService;
