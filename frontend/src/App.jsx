// =====================================================
// ПОЛНЫЙ FRONTEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Файл: src/App.jsx
// Версия с загрузкой структуры и поддержкой СИРИУС
// =====================================================

import React, { useState, useEffect, createContext, useContext } from 'react';
import axios from 'axios';
import './App.css';

// =====================================================
// НАСТРОЙКА API КЛИЕНТА
// =====================================================

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Добавляем токен к каждому запросу
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обработка ошибок авторизации
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// =====================================================
// КОНТЕКСТ АВТОРИЗАЦИИ
// =====================================================

const AuthContext = createContext(null);

// =====================================================
// КОМПОНЕНТ АВТОРИЗАЦИИ
// =====================================================

function LoginForm({ onLogin }) {
  const [credentials, setCredentials] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await api.post('/api/auth/login', credentials);
      localStorage.setItem('token', response.data.token);
      onLogin(response.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h2>Вход в систему РЭС</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Логин</label>
            <input
              type="text"
              value={credentials.login}
              onChange={(e) => setCredentials({...credentials, login: e.target.value})}
              required
            />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              required
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
        <div className="test-accounts">
          <p>Тестовые учетные записи:</p>
          <p>admin / admin123</p>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// ГЛАВНОЕ МЕНЮ
// =====================================================

function MainMenu({ activeSection, onSectionChange, userRole }) {
  const menuItems = [
    { id: 'structure', label: 'Структура сети', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'upload', label: 'Загрузить файлы', roles: ['admin', 'uploader'] },
    { id: 'notifications', label: 'Уведомления', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'pending', label: 'Ожидающие проверки', roles: ['admin', 'uploader', 'res_responsible'] },
    { id: 'reports', label: 'Отчеты', roles: ['admin'] },
    { id: 'settings', label: 'Настройки', roles: ['admin'] }
  ];

  const visibleItems = menuItems.filter(item => item.roles.includes(userRole));

  return (
    <nav className="main-menu">
      <h3>Меню РЭС</h3>
      {visibleItems.map(item => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={activeSection === item.id ? 'active' : ''}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

// =====================================================
// КОМПОНЕНТ СТРУКТУРЫ СЕТИ
// =====================================================

function NetworkStructure({ selectedRes }) {
  const [networkData, setNetworkData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTp, setSearchTp] = useState('');
  const { user } = useContext(AuthContext);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);    // <-- Добавить
  const [selectedPosition, setSelectedPosition] = useState(null); // <-- Добавить
  
  useEffect(() => {
    loadNetworkStructure();
  }, [selectedRes]);

  const loadNetworkStructure = async () => {
    try {
      const response = await api.get(`/api/network/structure/${selectedRes || ''}`);
      setNetworkData(response.data);
    } catch (error) {
      console.error('Error loading network structure:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'checked_ok': return 'status-ok';
      case 'checked_error': return 'status-error';
      case 'not_checked': return 'status-unchecked';
      case 'empty': return 'status-empty';
      default: return 'status-empty';
    }
  };

  const handleNotifyCompleted = async (networkStructureId) => {
    try {
      await api.post('/api/notifications/work-completed', {
        networkStructureId,
        message: 'Мероприятия выполнены'
      });
      alert('Уведомление отправлено');
    } catch (error) {
      alert('Ошибка отправки уведомления');
    }
  };

   const handleCellClick = (item, position) => {
    const puNumber = position === 'start' ? item.startPu : 
                     position === 'middle' ? item.middlePu : 
                     item.endPu;
    
    if (puNumber && item.PuStatuses) {
      const status = item.PuStatuses.find(s => 
        s.puNumber === puNumber && s.position === position
      );
      
      if (status && status.status === 'checked_error') {
        setSelectedDetails(status);
        setModalOpen(true);
      }
    }
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  const filteredData = networkData.filter(item => 
    !searchTp || item.tpName.toLowerCase().includes(searchTp.toLowerCase())
  );
  return (
    <div className="network-structure">
      <h2>Структура сети</h2>
      <div className="search-box">
        <input 
          type="text"
          placeholder="Поиск по ТП..."
          value={searchTp}
          onChange={(e) => setSearchTp(e.target.value)}
          className="search-input"
        />
      </div>
      <div className="structure-table">
        <table>
          <thead>
            <tr>
              <th>РЭС</th>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>Начало</th>
              <th>Середина</th>
              <th>Конец</th>
              <th>Дата обновления</th>
              {user.role === 'res_responsible' && <th>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id}>
                <td>{item.ResUnit?.name}</td>
                <td>{item.tpName}</td>
                <td>{item.vlName}</td>
                <td onClick={() => handleCellClick(item, 'start')}>
                  {item.startPu ? (
                    <div className={`status-box ${getStatusColor(
                      item.PuStatuses?.find(s => s.puNumber === item.startPu && s.position === 'start')?.status || 'not_checked'
                    )}`}>
                    </div>
                  ) : (
                    <div className="status-box status-empty">X</div>
                  )}
                </td>
                <td onClick={() => handleCellClick(item, 'middle')}>
                  {item.middlePu ? (
                    <div className={`status-box ${getStatusColor(
                      item.PuStatuses?.find(s => s.puNumber === item.middlePu && s.position === 'middle')?.status || 'not_checked'
                    )}`}>
                    </div>
                  ) : (
                    <div className="status-box status-empty">X</div>
                  )}
                </td>
                <td onClick={() => handleCellClick(item, 'end')}>
                  {item.endPu ? (
                    <div className={`status-box ${getStatusColor(
                      item.PuStatuses?.find(s => s.puNumber === item.endPu && s.position === 'end')?.status || 'not_checked'
                    )}`}>
                    </div>
                  ) : (
                    <div className="status-box status-empty">X</div>
                  )}
                </td>
                <td>{new Date(item.lastUpdate).toLocaleDateString('ru-RU')}</td>
                {user.role === 'res_responsible' && (
                  <td>
                    <button 
                      className="notify-btn"
                      onClick={() => handleNotifyCompleted(item.id)}
                    >
                      Уведомить
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="status-legend">
        <div><span className="status-box status-ok"></span> Проверен без ошибок</div>
        <div><span className="status-box status-error"></span> Проверен с ошибками</div>
        <div><span className="status-box status-unchecked"></span> Не проверен</div>
        <div><span className="status-box status-empty">X</span> Пустая ячейка</div>
      </div>
       <ErrorDetailsModal 
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        details={selectedDetails}
        tpName={selectedItem?.tpName}  // <-- Добавить
        vlName={selectedItem?.vlName}  // <-- Добавить
        position={selectedPosition}     // <-- Добавить
      />
    </div>
  );
}
    
function ErrorDetailsModal({ isOpen, onClose, details, tpName, vlName, position }) {
  if (!isOpen) return null;
  
  // Парсим детали если они в формате JSON строки
  let parsedDetails = null;
  try {
    if (details?.errorDetails) {
      // Пробуем распарсить JSON из errorDetails
      const match = details.errorDetails.match(/details":\s*({.*})/);
      if (match) {
        parsedDetails = JSON.parse(match[1]);
      }
    }
  } catch (e) {
    console.error('Failed to parse details:', e);
  }
  
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content error-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Детали проверки ПУ #{details?.puNumber}</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal-info">
          <p><strong>ТП:</strong> {tpName}</p>
          <p><strong>Фидер:</strong> {vlName}</p>
          <p><strong>Позиция:</strong> {position === 'start' ? 'Начало' : position === 'middle' ? 'Середина' : 'Конец'}</p>
        </div>
        
        <div className="error-summary">
          <h4>Обнаруженные отклонения:</h4>
          <div className="error-text">{details?.errorDetails || 'Нет данных'}</div>
        </div>
        
        {parsedDetails && (
          <div className="error-details-grid">
            {parsedDetails.overvoltage && Object.keys(parsedDetails.overvoltage).length > 0 && (
              <div className="error-section overvoltage">
                <h4>🔴 Перенапряжения</h4>
                {Object.entries(parsedDetails.overvoltage).map(([phase, data]) => (
                  <div key={phase} className="phase-details">
                    <span className="phase-label">Фаза {phase}:</span>
                    <span className="count">{data.count} событий</span>
                    <span className="voltage">Umax = {data.max}В</span>
                    <span className="period">{data.period}</span>
                  </div>
                ))}
              </div>
            )}
            
            {parsedDetails.undervoltage && Object.keys(parsedDetails.undervoltage).length > 0 && (
              <div className="error-section undervoltage">
                <h4>🔵 Провалы напряжения</h4>
                {Object.entries(parsedDetails.undervoltage).map(([phase, data]) => (
                  <div key={phase} className="phase-details">
                    <span className="phase-label">Фаза {phase}:</span>
                    <span className="count">{data.count} событий</span>
                    <span className="voltage">Umin = {data.min}В</span>
                    <span className="period">{data.period}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        <div className="modal-footer">
          <button className="action-btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ЗАГРУЗКИ ФАЙЛОВ
// =====================================================

function FileUpload({ selectedRes }) {
  const [selectedType, setSelectedType] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const { user } = useContext(AuthContext);

  const fileTypes = [
    { id: 'rim_single', label: 'Счетчики РИМ (отдельный файл)' },
    { id: 'rim_mass', label: 'Счетчики РИМ (массовая выгрузка)' },
    { id: 'nartis', label: 'Счетчики Нартис' },
    { id: 'energomera', label: 'Счетчики Энергомера' }
  ];

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file || !selectedType) {
      alert('Выберите тип файла и файл для загрузки');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', selectedType);
    if (user.role === 'admin' && selectedRes) {
      formData.append('resId', selectedRes);
    }

    try {
      const response = await api.post('/api/upload/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      alert(`Файл обработан. Обработано: ${response.data.processed}, Ошибок: ${response.data.errors}`);
      window.location.reload();
      setFile(null);
      setSelectedType('');
    } catch (error) {
      alert('Ошибка при загрузке файла');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-upload">
      <h2>Загрузка файлов для анализа</h2>
      <div className="upload-form">
        <div className="form-group">
          <label>Тип файла</label>
          <select 
            value={selectedType} 
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="">Выберите тип файла</option>
            {fileTypes.map(type => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>
        </div>
        
        {selectedType && (
          <div className="file-input-wrapper">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
            />
            {file && <p>Выбран файл: {file.name}</p>}
          </div>
        )}
        
        <button 
          onClick={handleUpload} 
          disabled={uploading || !file || !selectedType}
        >
          {uploading ? 'Загрузка...' : 'Загрузить и анализировать'}
        </button>
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ УВЕДОМЛЕНИЙ
// =====================================================

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const response = await api.get('/api/notifications');
      setNotifications(response.data);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`);
      setNotifications(notifications.map(n => 
        n.id === id ? {...n, isRead: true} : n
      ));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="notifications">
      <h2>Уведомления</h2>
      <div className="notifications-list">
        {notifications.map(notif => (
          <div 
            key={notif.id} 
            className={`notification ${notif.type} ${!notif.isRead ? 'unread' : ''}`}
            onClick={() => !notif.isRead && markAsRead(notif.id)}
          >
            <div className="notification-header">
              <span className="notification-from">От: {notif.fromUser?.fio || 'Система'}</span>
              <span className="notification-date">
                {new Date(notif.createdAt).toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="notification-message">{notif.message}</div>
            {notif.ResUnit && (
              <div className="notification-res">РЭС: {notif.ResUnit.name}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ОТЧЕТОВ
// =====================================================

function Reports() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await api.get('/api/reports/summary');
      setReportData(response.data);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="reports">
      <h2>Отчеты</h2>
      <div className="report-summary">
        <div className="report-card">
          <h3>Общая статистика</h3>
          <p>Всего ошибок: {reportData?.totalErrors || 0}</p>
          <p>Ожидают проверки: {reportData?.pendingChecks || 0}</p>
        </div>
        <div className="report-uploads">
          <h3>История загрузок</h3>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Пользователь</th>
                <th>РЭС</th>
                <th>Файл</th>
                <th>Обработано</th>
                <th>Ошибок</th>
              </tr>
            </thead>
            <tbody>
              {reportData?.uploads.map(upload => (
                <tr key={upload.id}>
                  <td>{new Date(upload.createdAt).toLocaleDateString('ru-RU')}</td>
                  <td>{upload.User?.fio}</td>
                  <td>{upload.ResUnit?.name}</td>
                  <td>{upload.fileName}</td>
                  <td>{upload.processedCount}</td>
                  <td>{upload.errorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ НАСТРОЕК (НОВЫЙ!)
// =====================================================

function Settings() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadStats, setUploadStats] = useState(null);
  const [clearOld, setClearOld] = useState(false);

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setMessage('');
    setUploadStats(null);
  };

  const handleUploadStructure = async () => {
    if (!file) {
      alert('Выберите файл');
      return;
    }

    if (clearOld && !confirm('Вы уверены что хотите удалить ВСЕ существующие данные перед загрузкой?')) {
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('clearOld', clearOld);

    try {
      const response = await api.post('/api/network/upload-full-structure', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setMessage('Структура сети успешно загружена!');
      setUploadStats(response.data);
      setFile(null);
      

      // ДОБАВЬ ЭТО - принудительное обновление страницы
      setTimeout(() => {
      window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('Ошибка загрузки: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
      setUploadStats(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="settings">
      <h2>Настройки системы</h2>
      
      <div className="upload-structure">
        <h3>Загрузка структуры сети</h3>
        
        <div className="file-input-wrapper">
          <input 
            type="file" 
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
          />
          {file && <p className="file-name">Выбран файл: {file.name}</p>}
        </div>
        
        <div className="checkbox-group">
          <label>
            <input 
              type="checkbox" 
              checked={clearOld}
              onChange={(e) => setClearOld(e.target.checked)}
            />
            Удалить существующие данные перед загрузкой
          </label>
        </div>
        
        <button 
          onClick={handleUploadStructure} 
          disabled={uploading || !file}
          className="upload-btn"
        >
          {uploading ? 'Загрузка...' : 'Загрузить структуру'}
        </button>
        
        {message && (
          <div className={message.includes('успешно') ? 'success-message' : 'error-message'}>
            {message}
          </div>
        )}
        
        {uploadStats && (
          <div className="upload-results">
            <h4>Результаты загрузки:</h4>
            <p>✅ Обработано: {uploadStats.processed} из {uploadStats.total} записей</p>
            {uploadStats.errors && uploadStats.errors.length > 0 && (
              <div className="errors-list">
                <p>⚠️ Ошибки при загрузке:</p>
                <ul>
                  {uploadStats.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// =====================================================
// ОСНОВНОЕ ПРИЛОЖЕНИЕ
// =====================================================

export default function App() {
  const [user, setUser] = useState(null);
  const [activeSection, setActiveSection] = useState('structure');
  const [selectedRes, setSelectedRes] = useState(null);
  const [resList, setResList] = useState([]);

  useEffect(() => {
    // Проверяем токен при загрузке
    const token = localStorage.getItem('token');
    if (token) {
      // Здесь можно добавить проверку токена через API
      // Пока просто парсим токен
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser(payload);
        setSelectedRes(payload.resId);
      } catch (error) {
        localStorage.removeItem('token');
      }
    }
  }, []);

  useEffect(() => {
    if (user && user.role === 'admin') {
      loadResList();
    }
  }, [user]);

  const loadResList = async () => {
    try {
      const response = await api.get('/api/res/list');
      setResList(response.data);
    } catch (error) {
      console.error('Error loading RES list:', error);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
    if (userData.resId) {
      setSelectedRes(userData.resId);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setSelectedRes(null);
  };

  if (!user) {
    return <LoginForm onLogin={handleLogin} />;
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'structure':
        return <NetworkStructure selectedRes={selectedRes} />;
      case 'upload':
        return <FileUpload selectedRes={selectedRes} />;
      case 'notifications':
        return <Notifications />;
      case 'pending':
        return <div className="pending">
          <h2>Ожидающие проверки</h2>
          <p>Список фидеров, ожидающих проверки после выполнения мероприятий</p>
        </div>;
      case 'reports':
        return <Reports />;
      case 'settings':
        return <Settings />;
      default:
        return <NetworkStructure selectedRes={selectedRes} />;
    }
  };

  return (
    <AuthContext.Provider value={{ user, selectedRes }}>
      <div className="app">
        <MainMenu 
          activeSection={activeSection} 
          onSectionChange={setActiveSection}
          userRole={user.role}
        />
        
        <div className="main-content">
          <header className="app-header">
            <div className="header-left">
              <h1>Система управления РЭС</h1>
              {user.role === 'admin' && (
                <select 
                  value={selectedRes || ''}
                  onChange={(e) => setSelectedRes(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">Все РЭСы</option>
                  {resList.map(res => (
                    <option key={res.id} value={res.id}>{res.name}</option>
                  ))}
                </select>
              )}
              {user.resId && (
                <span className="res-name">
                  {resList.find(r => r.id === user.resId)?.name || user.resName}
                </span>
              )}
            </div>
            
            <div className="header-right">
              <span>{user.fio}</span>
              <span className="user-role">
                ({user.role === 'admin' ? 'Администратор' : 
                  user.role === 'uploader' ? 'Загрузчик' : 'Ответственный'})
              </span>
              <button onClick={handleLogout} className="logout-btn">
                Выйти
              </button>
            </div>
          </header>
          
          <main className="content">
            {renderContent()}
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
