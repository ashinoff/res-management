// =====================================================
// ПОЛНЫЙ FRONTEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Файл: src/App.jsx
// Версия с ВСЕМИ исправлениями и улучшениями
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
    { id: 'tech_pending', label: 'Ожидающие мероприятий', roles: ['admin', 'res_responsible'] },
    { id: 'askue_pending', label: 'Ожидающие проверки АСКУЭ', roles: ['admin', 'uploader'] },
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
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  
  // Для редактирования
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  
  // Для выбора и удаления
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  
  useEffect(() => {
    loadNetworkStructure();
    
    // Слушаем событие обновления структуры
    const handleStructureUpdate = () => {
      loadNetworkStructure();
    };
    
    window.addEventListener('structureUpdated', handleStructureUpdate);
    return () => {
      window.removeEventListener('structureUpdated', handleStructureUpdate);
    };
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
      case 'pending_recheck': return 'status-pending';
      case 'empty': return 'status-empty';
      default: return 'status-empty';
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
        setSelectedItem(item);
        setSelectedPosition(position);
        setModalOpen(true);
      }
    }
  };
  
  // Начать редактирование
  const startEdit = (item, position) => {
    if (user.role !== 'admin') return;
    
    setEditingCell(`${item.id}-${position}`);
    const currentValue = position === 'start' ? item.startPu : 
                        position === 'middle' ? item.middlePu : 
                        item.endPu;
    setEditValue(currentValue || '');
  };
  
  // Сохранить изменения
  const saveEdit = async (item) => {
    try {
      const updateData = {
        startPu: item.startPu,
        middlePu: item.middlePu,
        endPu: item.endPu
      };
      
      const position = editingCell.split('-')[1];
      if (position === 'start') updateData.startPu = editValue || null;
      if (position === 'middle') updateData.middlePu = editValue || null;
      if (position === 'end') updateData.endPu = editValue || null;
      
      await api.put(`/api/network/structure/${item.id}`, updateData);
      
      await loadNetworkStructure();
      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      alert('Ошибка при сохранении');
    }
  };
  
  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };
  
  // Обработка выбора строк
  const handleSelectRow = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      } else {
        return [...prev, id];
      }
    });
  };
  
  const handleSelectAll = () => {
    if (selectedIds.length === filteredData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredData.map(item => item.id));
    }
  };
  
  // Удаление выбранных
  const handleDeleteSelected = async () => {
    if (deletePassword !== '1191') {
      alert('Неверный пароль');
      return;
    }
    
    try {
      const response = await api.post('/api/network/delete-selected', {
        ids: selectedIds,
        password: deletePassword
      });
      
      alert(response.data.message);
      setShowDeleteModal(false);
      setDeletePassword('');
      setSelectedIds([]);
      await loadNetworkStructure();
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };
  
  const renderPuCell = (item, position) => {
    const puNumber = position === 'start' ? item.startPu : 
                     position === 'middle' ? item.middlePu : 
                     item.endPu;
    const isEditing = editingCell === `${item.id}-${position}`;
    
    if (isEditing) {
      return (
        <div className="edit-cell">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') saveEdit(item);
              if (e.key === 'Escape') cancelEdit();
            }}
            autoFocus
          />
          <button onClick={() => saveEdit(item)} className="save-btn">✓</button>
          <button onClick={cancelEdit} className="cancel-btn">✗</button>
        </div>
      );
    }
    
    return (
      <div 
        className="pu-cell"
        onDoubleClick={() => startEdit(item, position)}
        title={user.role === 'admin' ? 'Двойной клик для редактирования' : ''}
      >
        {puNumber ? (
          <>
            <div 
              className={`status-box ${getStatusColor(
                item.PuStatuses?.find(s => s.puNumber === puNumber && s.position === position)?.status || 'not_checked'
              )}`}
              onClick={() => handleCellClick(item, position)}
            />
            <span className="pu-number">{puNumber}</span>
          </>
        ) : (
          <div className="status-box status-empty">X</div>
        )}
      </div>
    );
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  
  const filteredData = networkData.filter(item => 
    !searchTp || item.tpName.toLowerCase().includes(searchTp.toLowerCase())
  );
  
  return (
    <div className="network-structure">
      <h2>Структура сети</h2>
      {user.role === 'admin' && (
        <p className="edit-hint">💡 Двойной клик по номеру счетчика для редактирования</p>
      )}
      
      <div className="structure-controls">
        <div className="search-box">
          <input 
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
          />
        </div>
        
        {user.role === 'admin' && selectedIds.length > 0 && (
          <button 
            className="delete-selected-btn"
            onClick={() => setShowDeleteModal(true)}
          >
            🗑️ Удалить выбранные ({selectedIds.length})
          </button>
        )}
      </div>
      
      <div className="structure-table">
        <table>
          <thead>
            <tr>
              {user.role === 'admin' && (
                <th className="checkbox-column">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === filteredData.length && filteredData.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
              )}
              <th>РЭС</th>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>Начало</th>
              <th>Середина</th>
              <th>Конец</th>
              <th>Дата обновления</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.map(item => (
              <tr key={item.id} className={selectedIds.includes(item.id) ? 'selected' : ''}>
                {user.role === 'admin' && (
                  <td className="checkbox-column">
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => handleSelectRow(item.id)}
                    />
                  </td>
                )}
                <td>{item.ResUnit?.name}</td>
                <td>{item.tpName}</td>
                <td>{item.vlName}</td>
                <td>{renderPuCell(item, 'start')}</td>
                <td>{renderPuCell(item, 'middle')}</td>
                <td>{renderPuCell(item, 'end')}</td>
                <td>{new Date(item.lastUpdate).toLocaleDateString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="status-legend">
        <div><span className="status-box status-ok"></span> Проверен без ошибок</div>
        <div><span className="status-box status-error"></span> Проверен с ошибками</div>
        <div><span className="status-box status-unchecked"></span> Не проверен</div>
        <div><span className="status-box status-pending"></span> Ожидает перепроверки</div>
        <div><span className="status-box status-empty">X</span> Пустая ячейка</div>
      </div>
      
      <ErrorDetailsModal 
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        details={selectedDetails}
        tpName={selectedItem?.tpName}
        vlName={selectedItem?.vlName}
        position={selectedPosition}
      />
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить {selectedIds.length} записей.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteSelected}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Модальное окно с деталями ошибки
function ErrorDetailsModal({ isOpen, onClose, details, tpName, vlName, position }) {
  if (!isOpen || !details) return null;
  
  // Парсим детали если они в формате JSON строки
  let errorSummary = '';
  let parsedDetails = null;
  
  try {
    if (details?.errorDetails) {
      const parsed = JSON.parse(details.errorDetails);
      errorSummary = parsed.summary || details.errorDetails;
      parsedDetails = parsed.details;
    }
  } catch (e) {
    errorSummary = details?.errorDetails || 'Нет данных';
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
          <div className="error-text">{errorSummary}</div>
        </div>
        
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
  const [uploadResult, setUploadResult] = useState(null);
  const { user } = useContext(AuthContext);

  const fileTypes = [
    { id: 'rim_single', label: 'Счетчики РИМ (отдельный файл)' },
    { id: 'rim_mass', label: 'Счетчики РИМ (массовая выгрузка)' },
    { id: 'nartis', label: 'Счетчики Нартис' },
    { id: 'energomera', label: 'Счетчики Энергомера' }
  ];

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (!file || !selectedType) {
      alert('Выберите тип файла и файл для загрузки');
      return;
    }

    // Определяем resId
    let resIdToUse;
    if (user.role === 'admin') {
      resIdToUse = selectedRes || user.resId || 1;
    } else {
      resIdToUse = user.resId;
    }

    if (!resIdToUse) {
      alert('Ошибка: не определен РЭС для загрузки');
      return;
    }

    console.log('Upload params:', {
      file: file.name,
      type: selectedType,
      resId: resIdToUse,
      userRole: user.role
    });

    setUploading(true);
    setUploadResult(null);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', selectedType);
    formData.append('resId', resIdToUse);

    try {
      const response = await api.post('/api/upload/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      console.log('Upload response:', response.data);
      
      // Показываем результат
      setUploadResult({
        success: true,
        processed: response.data.processed,
        errors: response.data.errors,
        details: response.data.details
      });
      
      // Если были ошибки - покажем
      if (response.data.errors > 0) {
        alert(`Файл обработан! Найдено проблем: ${response.data.errors}`);
      } else {
        alert('Файл обработан успешно! Ошибок не найдено.');
      }
      
      // Сбрасываем форму
      setFile(null);
      setSelectedType('');
      
      // Создаем событие для обновления структуры
      window.dispatchEvent(new CustomEvent('structureUpdated'));
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadResult({
        success: false,
        error: error.response?.data?.error || 'Ошибка при загрузке файла'
      });
      alert('Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-upload">
      <h2>Загрузка файлов для анализа</h2>
      
      {/* Показываем для какого РЭС загружаем */}
      <div className="upload-info">
        <p>
          <strong>Загрузка для РЭС:</strong> {
            user.role === 'admin' && selectedRes 
              ? `Выбранный РЭС (ID: ${selectedRes})`
              : user.resName || 'Ваш РЭС'
          }
        </p>
        <p className="hint">
          💡 Имя файла должно совпадать с номером ПУ в структуре сети!
        </p>
      </div>
      
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
            {file && (
              <div className="file-info">
                <p>Выбран файл: <strong>{file.name}</strong></p>
                <p className="pu-number">Номер ПУ: <strong>{file.name.split('.')[0]}</strong></p>
              </div>
            )}
          </div>
        )}
        
        <button 
          onClick={handleUpload} 
          disabled={uploading || !file || !selectedType}
          className="upload-btn"
        >
          {uploading ? 'Загрузка и анализ...' : 'Загрузить и анализировать'}
        </button>
      </div>
      
      {/* Результаты загрузки */}
      {uploadResult && (
        <div className={`upload-result ${uploadResult.success ? 'success' : 'error'}`}>
          {uploadResult.success ? (
            <>
              <h3>✅ Анализ завершен</h3>
              <p>Обработано записей: {uploadResult.processed}</p>
              <p>Найдено ошибок: {uploadResult.errors}</p>
              {uploadResult.details && uploadResult.details.length > 0 && (
                <details>
                  <summary>Подробности</summary>
                  <pre>{JSON.stringify(uploadResult.details, null, 2)}</pre>
                </details>
              )}
            </>
          ) : (
            <>
              <h3>❌ Ошибка</h3>
              <p>{uploadResult.error}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ УВЕДОМЛЕНИЙ (ИСПРАВЛЕННЫЙ!)
// =====================================================

function Notifications({ filterType }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [comment, setComment] = useState('');
  const [checkFromDate, setCheckFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');
  const { user } = useContext(AuthContext);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteNotificationId, setDeleteNotificationId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  
  useEffect(() => {
    loadNotifications();
  }, [filterType]);

  const loadNotifications = async () => {
    try {
      const response = await api.get('/api/notifications');
      // Фильтруем по переданному типу
      const filtered = response.data.filter(n => {
        if (filterType) return n.type === filterType;
        return true;
      });
      setNotifications(filtered);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteWork = async () => {
    // Проверка на количество слов (минимум 5)
    const wordCount = comment.trim().split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount < 5) {
      alert('Комментарий должен содержать не менее 5 слов');
      return;
    }

    try {
      await api.post(`/api/notifications/${selectedNotification.id}/complete-work`, {
        comment,
        checkFromDate
      });
      
      alert('Мероприятия отмечены как выполненные');
      setShowCompleteModal(false);
      setComment('');
      setSelectedNotification(null);
      loadNotifications();
    } catch (error) {
      alert('Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    }
  };

  const handleDeleteNotification = async () => {
    if (deletePassword !== '1191') {
      alert('Неверный пароль');
      return;
    }
   
    try {
      await api.delete(`/api/notifications/${deleteNotificationId}`, {
        data: { password: deletePassword }
      });
     
      alert('Уведомление удалено');
      setShowDeleteModal(false);
      setDeletePassword('');
      setDeleteNotificationId(null);
      loadNotifications();
    } catch (error) {
      alert('Ошибка удаления: ' + (error.response?.data?.error || error.message));
    }
  };

  const renderAskueDetails = (message) => {
    try {
      const data = JSON.parse(message);
      return (
        <div className="askue-notification-content">
          <div className="askue-header">⚡ Требуется снять журнал событий</div>
          <div className="askue-details">
            <p><strong>ПУ №:</strong> {data.puNumber}</p>
            <p><strong>ТП:</strong> {data.tpName} | <strong>ВЛ:</strong> {data.vlName}</p>
            <p><strong>Позиция:</strong> {data.position === 'start' ? 'Начало' : data.position === 'middle' ? 'Середина' : 'Конец'}</p>
            
            <div className="highlight-box comment-box">
              <p className="highlight-label">💬 Комментарий РЭС:</p>
              <p className="highlight-text">{data.completedComment}</p>
            </div>
            
            <div className="highlight-box date-box">
              <p className="highlight-label">📅 Журнал с даты:</p>
              <p className="highlight-text">{new Date(data.checkFromDate).toLocaleDateString('ru-RU')}</p>
            </div>
            
            <div className="completed-info">
              <p><strong>Дата выполнения мероприятий:</strong> {new Date(data.completedAt).toLocaleString('ru-RU')}</p>
              <p><strong>Выполнил:</strong> Ответственный РЭС</p>
            </div>
          </div>
        </div>
      );
    } catch (e) {
      return <div>{message}</div>;
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  const title = filterType === 'error' ? 'Ожидающие мероприятий' : 
                filterType === 'pending_askue' ? 'Ожидающие проверки АСКУЭ' : 
                'Все уведомления';

  // Фильтрация по ТП
  const filteredNotifications = notifications.filter(notif => {
    if (!searchTp) return true;
    try {
      const data = JSON.parse(notif.message);
      return data.tpName?.toLowerCase().includes(searchTp.toLowerCase());
    } catch {
      return true;
    }
  });

  return (
    <div className="notifications">
      <h2>{title}</h2>
      
      <div className="notifications-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
          />
        </div>
      </div>
      
      <div className="notifications-list">
        {filteredNotifications.map(notif => (
          <div 
            key={notif.id} 
            className={`notification ${notif.type} ${!notif.isRead ? 'unread' : ''}`}
          >
            <div className="notification-header">
              <span className="notification-from">От: {notif.fromUser?.fio || 'Система'}</span>
              <div className="notification-actions">
                <span className="notification-date">
                  {new Date(notif.createdAt).toLocaleString('ru-RU')}
                </span>
                {user.role === 'admin' && (
                  <button
                    className="delete-notification-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteNotificationId(notif.id);
                      setShowDeleteModal(true);
                    }}
                    title="Удалить уведомление"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
            <div className="notification-body">
              {/* ИСПРАВЛЕННЫЙ БЛОК ДЛЯ УВЕДОМЛЕНИЙ ОБ ОШИБКАХ */}
              {notif.type === 'error' && (() => {
                try {
                  const data = JSON.parse(notif.message);
    
                  // ОТЛАДКА - добавь это временно
                  console.log('DEBUG Notification:', {
                    notifId: notif.id,
                    notifType: notif.type,
                    userRole: user.role,
                    filterType: filterType,
                    shouldShowButton: user.role === 'res_responsible'
                  });
    
                  return (
                    <div className="error-notification-content">
                      {/* ВРЕМЕННО для отладки */}
                      <div style={{background: '#f0f0f0', padding: '5px', fontSize: '12px', marginBottom: '10px'}}>
                        🐛 DEBUG: role={user.role}, filter={filterType}, type={notif.type}
                      </div>
        
                      <div className="error-location">
                        <span className="label">РЭС:</span> {data.resName} | 
                        <span className="label"> ТП:</span> {data.tpName} | 
                        <span className="label"> ВЛ:</span> {data.vlName} | 
                        <span className="label"> Позиция:</span> {
                          data.position === 'start' ? 'Начало' : 
                          data.position === 'middle' ? 'Середина' : 'Конец'
                        }
                      </div>
                      <div className="error-pu">
                        <span className="label">ПУ №:</span> {data.puNumber}
                      </div>
                      <div className="error-text">
                        <span className="label">Ошибка:</span> {data.errorDetails}
                      </div>
        
                      {/* КНОПКА БЕЗ УСЛОВИЙ для теста */}
                      <button 
                        className="complete-work-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Button clicked!', { notif, data });
                          setSelectedNotification({ id: notif.id, data });
                          setShowCompleteModal(true);
                        }}
                        style={{
                          display: 'block',
                          marginTop: '15px',
                          backgroundColor: user.role === 'res_responsible' ? '#28a745' : '#dc3545'
                        }}
                      >
                        ✅ Мероприятия выполнены (role: {user.role})
                      </button>
                    </div>
                  );
                } catch (e) {
                  return <div className="error-text">Ошибка отображения: {notif.message}</div>;
                }
              })()}
              
              {notif.type === 'pending_askue' && renderAskueDetails(notif.message)}
              
              {notif.type === 'success' && (
                <div className="success-notification-content">
                  <div className="success-icon">✅</div>
                  <div className="success-text">{notif.message}</div>
                </div>
              )}

              {notif.type === 'info' && (
                <div className="info-notification-content">
                  <div className="info-icon">ℹ️</div>
                  <div className="info-text">{notif.message}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Модальное окно для выполнения мероприятий */}
      {showCompleteModal && selectedNotification && (
        <div className="modal-backdrop" onClick={() => setShowCompleteModal(false)}>
          <div className="modal-content complete-work-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Отметить выполнение мероприятий</h3>
              <button className="close-btn" onClick={() => setShowCompleteModal(false)}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="work-info">
                <p><strong>ТП:</strong> {selectedNotification.data.tpName}</p>
                <p><strong>ВЛ:</strong> {selectedNotification.data.vlName}</p>
                <p><strong>ПУ №:</strong> {selectedNotification.data.puNumber}</p>
              </div>
              
              <div className="form-group">
                <label>Что было выполнено? (минимум 5 слов)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Опишите выполненные работы..."
                  rows={4}
                />
                <small className="word-count">
                  Слов: {comment.trim().split(/\s+/).filter(w => w.length > 0).length} из 5
                </small>
              </div>
              
              <div className="form-group">
                <label>Журнал событий требуется с даты:</label>
                <input
                  type="date"
                  value={checkFromDate}
                  onChange={(e) => setCheckFromDate(e.target.value)}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCompleteModal(false)}>
                Отмена
              </button>
              <button 
                className="confirm-btn" 
                onClick={handleCompleteWork}
                disabled={comment.trim().split(/\s+/).filter(w => w.length > 0).length < 5}
              >
                Подтвердить выполнение
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Модальное окно для удаления */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-content delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
              <button className="close-btn" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Вы собираетесь удалить это уведомление.</p>
              <p className="warning">⚠️ Это действие нельзя отменить!</p>
              <div className="form-group">
                <label>Введите пароль администратора:</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowDeleteModal(false)}>
                Отмена
              </button>
              <button 
                className="danger-btn" 
                onClick={handleDeleteNotification}
                disabled={!deletePassword}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ ОТЧЕТОВ
// =====================================================

function Reports() {
  const [reportType, setReportType] = useState('pending_work');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTp, setSearchTp] = useState('');

  useEffect(() => {
    loadReports();
  }, [reportType, dateFrom, dateTo]);

  const loadReports = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/reports/detailed', {
        params: {
          type: reportType,
          dateFrom,
          dateTo
        }
      });
      setReportData(response.data);
    } catch (error) {
      console.error('Error loading reports:', error);
      setReportData([]);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    // Создаем данные для экспорта
    const exportData = reportData.map(item => {
      const base = {
        'РЭС': item.resName,
        'ТП': item.tpName,
        'ВЛ': item.vlName,
        'Позиция': item.position === 'start' ? 'Начало' : item.position === 'middle' ? 'Середина' : 'Конец',
        'Номер ПУ': item.puNumber,
        'Ошибка': item.errorDetails,
        'Дата обнаружения': new Date(item.errorDate).toLocaleDateString('ru-RU')
      };

      if (reportType === 'pending_askue' || reportType === 'completed') {
        base['Комментарий РЭС'] = item.resComment;
        base['Дата завершения мероприятий'] = new Date(item.workCompletedDate).toLocaleDateString('ru-RU');
      }

      if (reportType === 'completed') {
        base['Дата перепроверки'] = new Date(item.recheckDate).toLocaleDateString('ru-RU');
        base['Результат'] = item.recheckResult === 'ok' ? 'Исправлено' : 'Не исправлено';
      }

      return base;
    });

    // Здесь бы использовать библиотеку для экспорта в Excel
    console.log('Export data:', exportData);
    alert('Функция экспорта будет реализована позже');
  };

  const getReportTitle = () => {
    switch (reportType) {
      case 'pending_work':
        return 'Ожидающие мероприятий';
      case 'pending_askue':
        return 'Ожидающие проверки АСКУЭ';
      case 'completed':
        return 'Завершенные проверки';
      default:
        return 'Отчет';
    }
  };

  // Фильтрация по ТП
  const filteredData = reportData.filter(item => 
    !searchTp || item.tpName?.toLowerCase().includes(searchTp.toLowerCase())
  );

  if (loading) return <div className="loading">Загрузка отчета...</div>;

  return (
    <div className="reports">
      <h2>Отчеты по проверкам</h2>
      
      <div className="report-controls">
        <div className="control-group">
          <label>Тип отчета:</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="pending_work">Ожидающие мероприятий</option>
            <option value="pending_askue">Ожидающие проверки АСКУЭ</option>
            <option value="completed">Завершенные проверки</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Период с:</label>
          <input 
            type="date" 
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <label>по:</label>
          <input 
            type="date" 
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <input 
            type="text"
            placeholder="Поиск по ТП..."
            value={searchTp}
            onChange={(e) => setSearchTp(e.target.value)}
            className="search-input"
          />
        </div>
        
        <button className="export-btn" onClick={exportToExcel}>
          📊 Экспорт в Excel
        </button>
      </div>
      
      <div className="report-summary">
        <h3>{getReportTitle()}</h3>
        <p>Найдено записей: {filteredData.length}</p>
      </div>
      
      <div className="report-table">
        <table>
          <thead>
            <tr>
              <th>РЭС</th>
              <th>ТП</th>
              <th>ВЛ</th>
              <th>Позиция</th>
              <th>Номер ПУ</th>
              <th>Ошибка</th>
              <th>Дата обнаружения</th>
              {(reportType === 'pending_askue' || reportType === 'completed') && (
                <>
                  <th>Комментарий РЭС</th>
                  <th>Дата завершения мероприятий</th>
                </>
              )}
              {reportType === 'completed' && (
                <>
                  <th>Дата перепроверки</th>
                  <th>Результат</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((item, idx) => (
              <tr key={idx}>
                <td>{item.resName}</td>
                <td>{item.tpName}</td>
                <td>{item.vlName}</td>
                <td>{item.position === 'start' ? 'Начало' : item.position === 'middle' ? 'Середина' : 'Конец'}</td>
                <td>{item.puNumber}</td>
                <td className="error-cell">{item.errorDetails}</td>
                <td>{new Date(item.errorDate).toLocaleDateString('ru-RU')}</td>
                {(reportType === 'pending_askue' || reportType === 'completed') && (
                  <>
                    <td>{item.resComment}</td>
                    <td>{new Date(item.workCompletedDate).toLocaleDateString('ru-RU')}</td>
                  </>
                )}
                {reportType === 'completed' && (
                  <>
                    <td>{new Date(item.recheckDate).toLocaleDateString('ru-RU')}</td>
                    <td className={item.recheckResult === 'ok' ? 'status-ok' : 'status-error'}>
                      {item.recheckResult === 'ok' ? '✅ Исправлено' : '❌ Не исправлено'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredData.length === 0 && (
          <div className="no-data">
            <p>Нет данных для отображения за выбранный период</p>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================
// КОМПОНЕНТ НАСТРОЕК
// =====================================================

function Settings() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadStats, setUploadStats] = useState(null);
  const [clearOld, setClearOld] = useState(false);
  const [clearing, setClearing] = useState(false);
  
  // Новое для управления пользователями
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userMessage, setUserMessage] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await api.get('/api/users/list');
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const createTestUsers = async () => {
    try {
      const response = await api.post('/api/users/create-test');
      setUserMessage(response.data.message);
      if (response.data.errors) {
        console.log('Errors:', response.data.errors);
      }
      loadUsers(); // Перезагружаем список
    } catch (error) {
      setUserMessage('Ошибка создания пользователей: ' + error.response?.data?.error);
    }
  };

  const handleFileSelect = (e) => {
    setFile(e.target.files[0]);
    setMessage('');
    setUploadStats(null);
  };

  const handleClearAll = async () => {
    if (!confirm('⚠️ Вы уверены что хотите удалить ВСЕ данные?\n\nБудут удалены:\n- Вся структура сети\n- Все статусы проверок\n- Все уведомления\n- Вся история загрузок\n\nЭто действие НЕЛЬЗЯ отменить!')) {
      return;
    }

    setClearing(true);
    try {
      const response = await api.delete('/api/network/clear-all');
      
      setMessage('✅ Все данные успешно удалены!');
      console.log('Cleared:', response.data.deleted);
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      setMessage('❌ Ошибка: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
    } finally {
      setClearing(false);
    }
  };

  const handleUploadStructure = async () => {
    if (!file) {
      alert('Выберите файл');
      return;
    }

    if (clearOld && !confirm('Вы уверены что хотите удалить существующие данные перед загрузкой?')) {
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
      
      setMessage('✅ Структура сети успешно загружена!');
      setUploadStats(response.data);
      setFile(null);
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('❌ Ошибка загрузки: ' + (error.response?.data?.error || 'Неизвестная ошибка'));
      setUploadStats(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="settings">
      <h2>Настройки системы</h2>
      
      {/* Секция управления пользователями */}
      <div className="users-section">
        <h3>👥 Управление пользователями</h3>
        
        <button 
          onClick={createTestUsers}
          className="action-btn"
          style={{marginBottom: '20px'}}
        >
          🧪 Создать тестовых пользователей
        </button>
        
        {userMessage && (
          <div className={userMessage.includes('Создано') ? 'success-message' : 'error-message'}>
            {userMessage}
          </div>
        )}
        
        <div className="users-table" style={{maxHeight: '300px', overflow: 'auto'}}>
          <table>
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>РЭС</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {loadingUsers ? (
                <tr><td colSpan="5">Загрузка...</td></tr>
              ) : (
                users.map(user => (
                  <tr key={user.id}>
                    <td>{user.fio}</td>
                    <td><strong>{user.login}</strong></td>
                    <td>
                      {user.role === 'admin' ? '👑 Админ' : 
                       user.role === 'uploader' ? '📤 Загрузчик' : 
                       '⚡ Ответственный'}
                    </td>
                    <td>{user.ResUnit?.name || '-'}</td>
                    <td>{user.email}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{marginTop: '10px', fontSize: '12px', color: '#666'}}>
            💡 Пароль для всех тестовых пользователей: <strong>test123</strong>
          </div>
        </div>
      </div>
      
      <hr style={{margin: '30px 0', border: '1px solid #e5e5e5'}} />
      
      {/* Секция очистки данных */}
      <div className="clear-data-section">
        <h3>⚠️ Очистка данных</h3>
        <p>Используйте эту опцию если хотите полностью перезагрузить структуру сети.</p>
        <button 
          onClick={handleClearAll}
          disabled={clearing}
          className="danger-btn"
        >
          {clearing ? 'Удаление...' : '🗑️ Удалить ВСЕ данные'}
        </button>
      </div>
      
      <hr style={{margin: '30px 0', border: '1px solid #e5e5e5'}} />
      
      {/* Секция загрузки структуры */}
      <div className="upload-structure">
        <h3>📂 Загрузка структуры сети</h3>
        
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
          {uploading ? 'Загрузка...' : '📤 Загрузить структуру'}
        </button>
        
        {message && (
          <div className={message.includes('✅') ? 'success-message' : 'error-message'}>
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
      case 'tech_pending':
        return <Notifications filterType="error" />;
      case 'askue_pending':
        return <Notifications filterType="pending_askue" />;
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
