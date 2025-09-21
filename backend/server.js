// =====================================================
// УЛУЧШЕННЫЙ BACKEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Версия с исправленной логикой уведомлений
// =====================================================

// Устанавливаем кодировку
process.env.LANG = 'ru_RU.UTF-8';
process.env.LC_ALL = 'ru_RU.UTF-8';
process.env.NODE_OPTIONS = '--encoding=utf-8';

console.log('Server starting...');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

const express = require('express');
console.log('Express loaded');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// =====================================================
// КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// =====================================================

require('dotenv').config();
const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});
const PORT = process.env.PORT || 3000;

// ВАЖНО: Пароль для удаления из переменной окружения
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || '1191';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Health check для Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RES Management Backend is running',
    version: '2.0.1',
    features: ['user-management', 'phase-detection', 'auto-updates', 'auto-hide-notifications']
  });
});

// Создаем папку uploads если её нет
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
// Конфигурация Cloudinary - автоматически использует CLOUDINARY_URL из .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Настройка хранилища для multer
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'res-management', // папка в Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    transformation: [{ width: 1920, height: 1920, crop: 'limit', quality: 'auto' }],
    // Генерируем уникальное имя файла
    public_id: (req, file) => {
      const timestamp = Date.now();
      const originalName = file.originalname.split('.')[0];
      return `${req.body.type || 'attachment'}_${timestamp}_${originalName}`;
    }
  }
});

// Создаем новый upload middleware для Cloudinary
const uploadToCloud = multer({ 
  storage: cloudinaryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB максимум
  }
});


// =====================================================
// ПОДКЛЮЧЕНИЕ К БД (PostgreSQL на Render)
// =====================================================

const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/dbname', {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false,
    charset: 'utf8',
    client_encoding: 'UTF8'
  },
  logging: false
});

// =====================================================
// МОДЕЛИ ДАННЫХ
// =====================================================

// 1. Модель РЭС (районов)
const ResUnit = sequelize.define('ResUnit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
});

// 2. Модель пользователей
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fio: {
    type: DataTypes.STRING,
    allowNull: false
  },
  login: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'uploader', 'res_responsible'),
    allowNull: false
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// 3. Модель структуры сети (ТП и ВЛ)
const NetworkStructure = sequelize.define('NetworkStructure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  endPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  middlePu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastUpdate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// 4. Модель статусов ПУ (приборов учета)
const PuStatus = sequelize.define('PuStatus', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('not_checked', 'checked_ok', 'checked_error', 'pending_recheck', 'empty'),
    defaultValue: 'not_checked'
  },
  errorDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastCheck: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// 5. Модель уведомлений
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fromUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  toUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  puStatusId: {
    type: DataTypes.INTEGER,
    references: {
      model: PuStatus,
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('error', 'success', 'info', 'pending_check', 'pending_askue', 'problem_vl'), // ← ЗДЕСЬ ДОБАВИТЬ 'problem_vl'
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  errorData: {
    type: DataTypes.JSON,
    allowNull: true
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  checkFromDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// 6. Модель истории загрузок
const UploadHistory = sequelize.define('UploadHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileType: {
    type: DataTypes.ENUM('rim_single', 'rim_mass', 'nartis', 'energomera'),
    allowNull: false
  },
  processedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  errorCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('processing', 'completed', 'failed'),
    defaultValue: 'processing'
  }
});

// 7. Модель истории проверок
const CheckHistory = sequelize.define('CheckHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  initialError: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  initialCheckDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  resComment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  workCompletedDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recheckDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recheckResult: {
    type: DataTypes.ENUM('pending', 'ok', 'error'),
    defaultValue: 'pending'
  },
  status: {
    type: DataTypes.ENUM('awaiting_work', 'awaiting_recheck', 'completed'),
    defaultValue: 'awaiting_work'
  },
   // НОВОЕ ПОЛЕ для хранения прикрепленных файлов
    attachments: {
      type: DataTypes.JSON,  // Будем хранить массив объектов с url и public_id
      defaultValue: []
  },
  failureCount: {
    type: DataTypes.INTEGER,
    defaultValue: 1  // Первая ошибка уже считается
  }

});



// 8. Модель проблемных ВЛ (2+ неудачных проверки)
const ProblemVL = sequelize.define('ProblemVL', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  position: {
    type: DataTypes.ENUM('start', 'middle', 'end'),
    allowNull: false
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  failureCount: {
    type: DataTypes.INTEGER,
    defaultValue: 2
  },
  lastErrorDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  lastErrorDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  firstReportDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  resComment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'resolved', 'dismissed'),
    defaultValue: 'active'
  }
});

// 9. Модель прочтений уведомлений (НОВАЯ)
const NotificationRead = sequelize.define('NotificationRead', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  notificationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Notification,
      key: 'id'
    }
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  readAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['notificationId', 'userId'] // один пользователь может прочитать одно уведомление только раз
    }
  ]
});

// 10. Модель истории загрузок для каждого ПУ (НОВАЯ)
const PuUploadHistory = sequelize.define('PuUploadHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    index: true
  },
  uploadedBy: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileType: {
    type: DataTypes.ENUM('rim_single', 'rim_mass', 'nartis', 'energomera'),
    allowNull: false
  },
  periodStart: {
    type: DataTypes.DATE,
    allowNull: true
  },
  periodEnd: {
    type: DataTypes.DATE,
    allowNull: true
  },
  hasErrors: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  errorSummary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  errorDetails: {
    type: DataTypes.JSON,
    allowNull: true
  },
  uploadStatus: {
    type: DataTypes.ENUM('success', 'duplicate', 'wrong_period', 'error'),
    defaultValue: 'success'
  },
  uploadedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});



// =====================================================
// СВЯЗИ МЕЖДУ МОДЕЛЯМИ
// =====================================================

User.belongsTo(ResUnit, { foreignKey: 'resId' });
ResUnit.hasMany(User, { foreignKey: 'resId' });
NetworkStructure.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.hasMany(PuStatus, { foreignKey: 'networkStructureId' });
PuStatus.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
Notification.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });
Notification.belongsTo(ResUnit, { foreignKey: 'resId' });
Notification.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(PuStatus, { foreignKey: 'puStatusId' });
UploadHistory.belongsTo(User, { foreignKey: 'userId' });
UploadHistory.belongsTo(ResUnit, { foreignKey: 'resId' });
CheckHistory.belongsTo(ResUnit, { foreignKey: 'resId' });
CheckHistory.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
CheckHistory.belongsTo(User, { as: 'uploadedByUser', foreignKey: 'resId' });
ProblemVL.belongsTo(ResUnit, { foreignKey: 'resId' });
ProblemVL.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.hasMany(NotificationRead, { foreignKey: 'notificationId' });
NotificationRead.belongsTo(Notification, { foreignKey: 'notificationId' });
NotificationRead.belongsTo(User, { foreignKey: 'userId' });
PuUploadHistory.belongsTo(User, { foreignKey: 'uploadedBy' });

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

// Хеширование паролей
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

User.beforeUpdate(async (user) => {
  if (user.changed('password') && user.password && !user.password.startsWith('$2a$')) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

// Валидация пароля
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки ролей
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
};

// Настройка multer для загрузки файлов с ограничением размера
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB максимум
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только Excel и CSV файлы'));
    }
  }
});

// Обработчик ошибок multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'Файл слишком большой. Максимальный размер: 10MB' 
      });
    }
  }
  next(error);
});

// Email сервис
const createEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.mail.ru',
    port: process.env.MAIL_PORT || 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
};

// =====================================================
// API РОУТЫ
// =====================================================

// 1. АВТОРИЗАЦИЯ
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    const user = await User.findOne({ 
      where: { login },
      include: [ResUnit]
    });
    
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        resId: user.resId,
        
      },
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        fio: user.fio,
        role: user.role,
        resId: user.resId,
        resName: user.ResUnit?.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1.1 ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'fio', 'login', 'role', 'resId', 'email'],
      include: [ResUnit]
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        fio: user.fio,
        role: user.role,
        resId: user.resId,
        resName: user.ResUnit?.name
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ПОЛУЧЕНИЕ СПИСКА РЭС
app.get('/api/res/list', authenticateToken, async (req, res) => {
  try {
    const resList = await ResUnit.findAll({
      order: [['name', 'ASC']]
    });
    res.json(resList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ПОЛУЧЕНИЕ СТРУКТУРЫ СЕТИ
app.get('/api/network/structure/:resId?', authenticateToken, async (req, res) => {
  try {
    const resId = req.params.resId || req.user.resId;
    
    // Если не админ, может видеть только свой РЭС
    if (req.user.role !== 'admin' && resId != req.user.resId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Адлерский РЭС (id=2) также видит СИРИУС (id=8)
    let whereClause = {};
    if (resId) {
      if (resId == 2 || req.user.resId == 2) {
        // Если смотрим Адлерский РЭС или пользователь из Адлерского - показываем и СИРИУС
        whereClause = { resId: { [Op.in]: [2, 8] } };
      } else {
        whereClause = { resId };
      }
    }
    
    const structures = await NetworkStructure.findAll({
      where: whereClause,
      include: [
        {
          model: PuStatus,
          required: false,
          attributes: ['id', 'puNumber', 'position', 'status', 'errorDetails', 'lastCheck']
        },
        ResUnit
      ],
      order: [['tpName', 'ASC'], ['vlName', 'ASC']]
    });
    
    res.json(structures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ОБНОВЛЕНИЕ структуры сети (только админ)
app.put('/api/network/structure/:id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { startPu, middlePu, endPu } = req.body;
      
      await NetworkStructure.update({
        startPu: startPu || null,
        middlePu: middlePu || null,
        endPu: endPu || null,
        lastUpdate: new Date()
      }, {
        where: { id: req.params.id }
      });
      
      res.json({ success: true, message: 'Структура обновлена' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 5. ЗАГРУЗКА ФАЙЛОВ ДЛЯ АНАЛИЗА
app.post('/api/upload/analyze',
  authenticateToken,
  checkRole(['admin', 'uploader']),
  upload.single('file'),
  async (req, res) => {
    let uploadRecord;
    try {
      const { type, requiredPeriod } = req.body;
      const userId = req.user.id;
      
      // Берем resId из body (если есть) или из токена пользователя
      const resId = req.body.resId || req.user.resId;

      console.log('=== UPLOAD DEBUG ===');
      console.log('userId from token:', userId);
      console.log('req.user:', req.user);

      console.log('=== UPLOAD ANALYZE START ===');
      console.log('User:', req.user);
      console.log('Request body:', req.body);
      console.log('Final resId:', resId);
      console.log('File:', req.file?.originalName);

      if (!resId) {
        return res.status(400).json({ error: 'Не выбран РЭС для загрузки' });
      }
      
      // Создаем запись в истории
      uploadRecord = await UploadHistory.create({
        userId,
        resId,
        fileName: req.file.originalname,
        fileType: type,
        status: 'processing'
      });
      
      console.log('Upload record created:', uploadRecord.id);
      
      // Запускаем анализ с передачей оригинального имени файла
      console.log('Starting analysis...');
      const analysisResult = await analyzeFile(
        req.file.path, 
        type, 
        req.file.originalname, // передаем оригинальное имя
        requiredPeriod,
        userId
      );
      
      console.log('Analysis result:', {
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length
      });
      
      // Обновляем историю
      await uploadRecord.update({
        processedCount: analysisResult.processed.length,
        errorCount: analysisResult.errors.length,
        status: 'completed'
      });
      
      // Отправляем уведомления если есть ошибки
      if (analysisResult.errors.length > 0) {
        console.log(`Creating notifications for ${analysisResult.errors.length} errors`);
        try {
          await createNotifications(userId, resId, analysisResult.errors);
          console.log('Notifications created successfully');
        } catch (notifError) {
          console.error('Error creating notifications:', notifError);
          // НЕ падаем, продолжаем работу!
        }
      }
      
      console.log('=== UPLOAD ANALYZE COMPLETE ===');
      
      // Возвращаем результат
      res.json({
        success: true,
        message: 'Файл обработан успешно',
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length,
        details: analysisResult.processed
      });
      
    } catch (error) {
      console.error('Upload analyze error:', error);
      
      // Обновляем статус в истории
      if (uploadRecord) {
        await uploadRecord.update({ status: 'failed' });
      }
      
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
});

// 6. ЗАГРУЗКА ПОЛНОЙ СТРУКТУРЫ СЕТИ
app.post('/api/network/upload-full-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      let processed = 0;
      let errors = [];
      
           
      // Обрабатываем каждую строку
      for (const row of data) {
        try {
          // Ищем РЭС по полному имени из Excel
          const resName = row['РЭС'];
          const res = await ResUnit.findOne({ 
            where: { name: resName },
            transaction 
          });
          
          if (!res) {
            errors.push(`Неизвестный РЭС: ${resName}`);
            continue;
          }
          
          // Создаем или обновляем запись
          await NetworkStructure.upsert({
            resId: res.id,
            tpName: row['ТП'] || '',
            vlName: row['Фидер'] || '',
            startPu: row['Начало'] ? String(row['Начало']) : null,
            endPu: row['Конец'] ? String(row['Конец']) : null,
            middlePu: row['Середина'] ? String(row['Середина']) : null
          }, {
            transaction
          });
          
          processed++;
          
          // Создаем статусы для новых ПУ
          const positions = [
            { pu: row['Начало'], pos: 'start' },
            { pu: row['Конец'], pos: 'end' },
            { pu: row['Середина'], pos: 'middle' }
          ];
          
          for (const { pu, pos } of positions) {
            if (pu) {
              await PuStatus.findOrCreate({
                where: { puNumber: String(pu) },
                defaults: {
                  position: pos,
                  status: 'not_checked'
                },
                transaction
              });
            }
          }
          
        } catch (err) {
          errors.push(`Ошибка в строке ${row['ТП']}-${row['Фидер']}: ${err.message}`);
        }
      }
      
      await transaction.commit();
      
      // Удаляем файл
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        message: `Загружено ${processed} записей из ${data.length}`,
        processed,
        total: data.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// 7. ПОЛУЧЕНИЕ УВЕДОМЛЕНИЙ

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    let whereClause = {};
    
    if (req.user.role === 'admin') {
      whereClause = {};
    } else if (req.user.role === 'res_responsible') {
      whereClause = {
        resId: req.user.resId,
        [Op.or]: [
          { toUserId: null },
          { toUserId: req.user.id }
        ]
      };
    } else {
      whereClause = { toUserId: req.user.id };
    }
    
    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'fromUser' },
        { model: User, as: 'toUser' },
        ResUnit,
        NetworkStructure,
        NotificationRead // Добавляем прочтения
      ],
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    
    // Добавляем информацию о прочтении для текущего пользователя
    const notificationsWithReadStatus = notifications.map(notif => {
      const isRead = notif.NotificationReads?.some(read => 
        read.userId === req.user.id
      ) || false;
      
      return {
        ...notif.toJSON(),
        isRead: isRead // Персональный статус прочтения
      };
    });
    
    res.json(notificationsWithReadStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ВЫПОЛНЕНИЕ МЕРОПРИЯТИЙ

app.post('/api/notifications/:id/complete-work', 
  authenticateToken, 
  checkRole(['res_responsible']),
  uploadToCloud.array('attachments', 5), // Позволяем загрузить до 5 файлов
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { comment, checkFromDate } = req.body;
      
      // Проверка на количество слов (минимум 5)
      const wordCount = comment.trim().split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount < 5) {
        return res.status(400).json({ error: 'Комментарий должен содержать не менее 5 слов' });
      }
      // Обрабатываем загруженные файлы
      const attachments = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          attachments.push({
            url: file.path, // Cloudinary URL
            public_id: file.filename, // Cloudinary public_id для удаления
            original_name: file.originalname,
            size: file.size,
            uploaded_at: new Date()
          });
        }
        console.log(`Uploaded ${attachments.length} files to Cloudinary`);
        console.log('Attachments data:', JSON.stringify(attachments, null, 2));
      }

      
      // Находим уведомление
      const notification = await Notification.findByPk(req.params.id);
      if (!notification) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Уведомление не найдено' });
      }
      
      // Парсим данные об ошибке
      const errorData = JSON.parse(notification.message);
      
      // Создаем запись в истории проверок
      await CheckHistory.create({
  resId: notification.resId,
  networkStructureId: notification.networkStructureId,
  puNumber: errorData.puNumber,
  tpName: errorData.tpName,
  vlName: errorData.vlName,
  position: errorData.position,
  initialError: errorData.errorDetails,
  initialCheckDate: notification.createdAt,
  resComment: comment,
  workCompletedDate: new Date(),
  checkFromDate: checkFromDate ? new Date(checkFromDate) : new Date(), // ДОБАВИТЬ ЭТО
  status: 'awaiting_recheck',
  attachments: attachments
}, { transaction });
      console.log('CheckHistory created with attachments:', attachments.length);
      // Обновляем статус ПУ на pending_recheck
      await PuStatus.update(
        { status: 'pending_recheck' },
        { 
          where: { puNumber: errorData.puNumber },
          transaction
        }
      );
      
      // УДАЛЯЕМ старое уведомление
      await notification.destroy({ transaction });
      
      // Создаем новое уведомление для АСКУЭ
      const askueUsers = await User.findAll({
        where: {
          resId: notification.resId,
          role: 'uploader'
        }
      });
      
      const askueMessage = {
        puNumber: errorData.puNumber,
        position: errorData.position,
        tpName: errorData.tpName,
        vlName: errorData.vlName,
        resName: errorData.resName,
        errorDetails: errorData.errorDetails,
        checkFromDate: checkFromDate || new Date().toISOString().split('T')[0],
        completedComment: comment,
        completedBy: req.user.id,
        completedAt: new Date()
      };
      
      for (const askueUser of askueUsers) {
        await Notification.create({
          fromUserId: req.user.id,
          toUserId: askueUser.id,
          resId: notification.resId,
          networkStructureId: notification.networkStructureId,
          type: 'pending_askue',
          message: JSON.stringify(askueMessage),
          isRead: false
        }, { transaction });
      }
      
      await transaction.commit();
      res.json({ success: true, message: 'Мероприятия отмечены как выполненные' });
      
    } catch (error) {
       // Если ошибка - удаляем загруженные файлы из Cloudinary
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            await cloudinary.uploader.destroy(file.filename);
          } catch (err) {
            console.error('Error deleting file from Cloudinary:', err);
          }
        }
      }
      
      await transaction.rollback();
      console.error('Complete work error:', error);
      res.status(500).json({ error: error.message });
    }
});

// 9. ОЧИСТКА ВСЕХ ДАННЫХ
app.delete('/api/network/clear-all', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { password, beforeDate } = req.body;  // ДОБАВИЛИ beforeDate
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      console.log('Starting data cleanup...');
      console.log('Before date:', beforeDate);
      
      // Формируем условие для удаления
      let whereClause = {};
      if (beforeDate) {
        whereClause.createdAt = { [Op.lt]: new Date(beforeDate) };
      }
      
      // 1. NotificationRead
      const notificationReadsDeleted = await NotificationRead.destroy({ 
        where: whereClause, 
        transaction 
      });
      console.log(`Deleted ${notificationReadsDeleted} notification read records`);
      
      // 2. PuUploadHistory (используем uploadedAt)
      let uploadWhereClause = {};
      if (beforeDate) {
        uploadWhereClause.uploadedAt = { [Op.lt]: new Date(beforeDate) };
      }
      
      const puUploadHistoryDeleted = await PuUploadHistory.destroy({ 
        where: uploadWhereClause, 
        transaction 
      });
      console.log(`Deleted ${puUploadHistoryDeleted} PU upload history records`);
      
      // 3. ProblemVL - удаляем только неактивные или старые
      let problemWhereClause = {};
      if (beforeDate) {
        problemWhereClause.createdAt = { [Op.lt]: new Date(beforeDate) };
        problemWhereClause.status = { [Op.ne]: 'active' }; // не трогаем активные
      }
      
      const problemVLDeleted = await ProblemVL.destroy({ 
        where: problemWhereClause, 
        transaction 
      });
      console.log(`Deleted ${problemVLDeleted} problem VL records`);
      
      // 4. CheckHistory  
      const checkHistoryDeleted = await CheckHistory.destroy({ 
        where: whereClause, 
        transaction 
      });
      console.log(`Deleted ${checkHistoryDeleted} check history records`);
      
      // 5. История загрузок
      const uploadsDeleted = await UploadHistory.destroy({ 
        where: whereClause, 
        transaction 
      });
      console.log(`Deleted ${uploadsDeleted} upload records`);
      
      // 6. Уведомления
      const notificationsDeleted = await Notification.destroy({ 
        where: whereClause, 
        transaction 
      });
      console.log(`Deleted ${notificationsDeleted} notifications`);
      
      // 7. Статусы ПУ - НЕ УДАЛЯЕМ, только сбрасываем старые
      if (beforeDate) {
        await PuStatus.update(
          { 
            status: 'not_checked',
            errorDetails: null,
            lastCheck: null
          },
          { 
            where: {
              lastCheck: { [Op.lt]: new Date(beforeDate) }
            },
            transaction 
          }
        );
      } else {
        // Если нет даты - сбрасываем все
        await PuStatus.update(
          { 
            status: 'not_checked',
            errorDetails: null,
            lastCheck: null
          },
          { 
            where: {},
            transaction 
          }
        );
      }
      
      // 8. Теперь можем удалить структуру сети
      const structuresDeleted = await NetworkStructure.destroy({ 
        where: {}, 
        transaction 
      });
      console.log(`Deleted ${structuresDeleted} network structures`);
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: beforeDate 
          ? `Данные до ${new Date(beforeDate).toLocaleDateString('ru-RU')} успешно удалены`
          : 'История и статусы успешно очищены (структура сохранена)',
        deleted: {
          notificationReads: notificationReadsDeleted,
          puUploadHistory: puUploadHistoryDeleted,
          problemVL: problemVLDeleted,
          checkHistory: checkHistoryDeleted,
          uploads: uploadsDeleted,
          notifications: notificationsDeleted,
          // structures: 0  // Структура не удалялась
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Clear data error:', error);
      res.status(500).json({ 
        error: 'Ошибка при удалении данных: ' + error.message 
      });
    }
});

// 10. УДАЛЕНИЕ ВЫБРАННЫХ СТРУКТУР
app.post('/api/network/delete-selected', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { ids, password } = req.body;
      
      // Проверка пароля
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Не выбраны записи для удаления' });
      }
      
      console.log(`Deleting network structures: ${ids.join(', ')}`);
      
      // ВАЖНО: правильный порядок удаления!
      
      // 1. Сначала удаляем CheckHistory (новое!)
      const checkHistoryDeleted = await CheckHistory.destroy({
        where: {
          networkStructureId: { [Op.in]: ids }
        },
        transaction
      });
      
      // 2. Удаляем уведомления
      const notificationsDeleted = await Notification.destroy({
        where: {
          networkStructureId: { [Op.in]: ids }
        },
        transaction
      });
      
      // 3. Удаляем статусы ПУ
      const puStatusesDeleted = await PuStatus.destroy({
        where: {
          networkStructureId: { [Op.in]: ids }
        },
        transaction
      });
      
      // 4. Теперь можем удалить сами структуры
      const structuresDeleted = await NetworkStructure.destroy({
        where: {
          id: { [Op.in]: ids }
        },
        transaction
      });
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: `Удалено ${structuresDeleted} записей`,
        deleted: {
          structures: structuresDeleted,
          checkHistory: checkHistoryDeleted,
          notifications: notificationsDeleted,
          puStatuses: puStatusesDeleted
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Delete selected error:', error);
      res.status(500).json({ error: error.message });
    }
});

// 11. ДЕТАЛЬНЫЕ ОТЧЕТЫ
app.get('/api/reports/detailed', authenticateToken, async (req, res) => {
  try {
    const { type, dateFrom, dateTo } = req.query;
    
    let whereClause = {};
    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        whereClause.createdAt[Op.lte] = endDate;
      }
    }
    
    // Добавляем фильтр по РЭС для не-админов
    if (req.user.role !== 'admin') {
      whereClause.resId = req.user.resId;
    }
    
    let reportData = [];
    
    switch (type) {
      case 'pending_work':
        // Ожидающие мероприятий
        const pendingWork = await Notification.findAll({
          where: {
            ...whereClause,
            type: 'error',
            isRead: false
          },
          include: [
            { model: ResUnit },
            { model: NetworkStructure }
          ]
        });
        
        reportData = pendingWork.map(n => {
          const data = JSON.parse(n.message);
          return {
            resName: n.ResUnit?.name,
            tpName: data.tpName,
            vlName: data.vlName,
            position: data.position,
            puNumber: data.puNumber,
            errorDetails: data.errorDetails,
            errorDate: n.createdAt
          };
        });
        break;
        
      case 'pending_askue':
        // Ожидающие проверки АСКУЭ
        const pendingAskue = await Notification.findAll({
          where: {
            ...whereClause,
            type: 'pending_askue',
            isRead: false
          },
          include: [
            { model: ResUnit },
            { model: NetworkStructure }
          ]
        });
        
        reportData = pendingAskue.map(n => {
          const data = JSON.parse(n.message);
          return {
            resName: n.ResUnit?.name,
            tpName: data.tpName,
            vlName: data.vlName,
            position: data.position,
            puNumber: data.puNumber,
            errorDetails: data.errorDetails || 'Требуется перепроверка',
            errorDate: n.createdAt,
            resComment: data.completedComment,
            workCompletedDate: data.completedAt
          };
        });
        break;
        
      case 'completed':
        // Завершенные проверки
        const completed = await CheckHistory.findAll({
          where: {
            ...whereClause,
            status: 'completed'
          },
          include: [ResUnit]
        });
        
        reportData = completed.map(h => ({
          resName: h.ResUnit?.name,
          tpName: h.tpName,
          vlName: h.vlName,
          position: h.position,
          puNumber: h.puNumber,
          errorDetails: h.initialError,
          errorDate: h.initialCheckDate,
          resComment: h.resComment,
          workCompletedDate: h.workCompletedDate,
          recheckDate: h.recheckDate,
          recheckResult: h.recheckResult,
          attachments: h.attachments || []
        }));
        break;
    }
    
    res.json(reportData);
  } catch (error) {
    console.error('Detailed reports error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12. УДАЛЕНИЕ УВЕДОМЛЕНИЙ
app.delete('/api/notifications/:id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      
      // Проверка пароля через переменную окружения
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      const notification = await Notification.findByPk(req.params.id);
      if (!notification) {
        return res.status(404).json({ error: 'Уведомление не найдено' });
      }
      
      await notification.destroy();
      
      res.json({ 
        success: true, 
        message: 'Уведомление удалено' 
      });
      
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({ error: error.message });
    }
});

// роут ДЛЯ ОТЧЕТОВ эксель
app.get('/api/reports/export-history', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const history = await CheckHistory.findAll({
        include: [ResUnit, NetworkStructure],
        order: [['createdAt', 'DESC']]
      });
      
      const data = history.map(h => ({
        'ID': h.id,
        'РЭС': h.ResUnit?.name,
        'ТП': h.tpName,
        'ВЛ': h.vlName,
        'ПУ': h.puNumber,
        'Позиция': h.position === 'start' ? 'Начало' : h.position === 'middle' ? 'Середина' : 'Конец',
        'Первоначальная ошибка': h.initialError,
        'Дата обнаружения': h.initialCheckDate,
        'Комментарий РЭС': h.resComment || '-',
        'Дата выполнения работ': h.workCompletedDate || '-',
        'Дата перепроверки': h.recheckDate || '-',
        'Результат': h.recheckResult === 'ok' ? 'Исправлено' : h.recheckResult === 'error' ? 'Не исправлено' : 'Ожидает',
        'Статус': h.status === 'completed' ? 'Завершено' : h.status === 'awaiting_recheck' ? 'Ожидает перепроверки' : 'Ожидает работ'
      }));
      
      res.json({
        success: true,
        data: data,
        count: data.length
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});


// Удаление файла
app.delete('/api/admin/files/:public_id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      // Удаляем из Cloudinary
      await cloudinary.uploader.destroy(req.params.public_id);
      
      // Удаляем из БД
      const records = await CheckHistory.findAll({
        where: {
          attachments: {
            [Op.contains]: [{public_id: req.params.public_id}]
          }
        }
      });
      
      for (const record of records) {
        const newAttachments = record.attachments.filter(
          file => file.public_id !== req.params.public_id
        );
        await record.update({ attachments: newAttachments });
      }
      
      res.json({ success: true, message: 'Файл удален' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});


// =====================================================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// =====================================================

// 13. ПОЛУЧЕНИЕ СПИСКА ПОЛЬЗОВАТЕЛЕЙ
app.get('/api/users/list', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'fio', 'login', 'role', 'resId', 'email', 'createdAt'],
      include: [ResUnit],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 14. СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
app.post('/api/users/create', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const { fio, login, password, email, role, resId } = req.body;
    
    // Валидация
    if (!fio || !login || !password || !email || !role) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }
    
    if (role !== 'admin' && !resId) {
      return res.status(400).json({ error: 'Для не-админов необходимо указать РЭС' });
    }
    
    // Проверка уникальности логина
    const existingUser = await User.findOne({ where: { login } });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }
    
    // Создание пользователя
    const user = await User.create({
      fio,
      login,
      password,
      email,
      role,
      resId: role === 'admin' ? null : resId
    });
    
    const createdUser = await User.findByPk(user.id, {
      attributes: ['id', 'fio', 'login', 'role', 'resId', 'email'],
      include: [ResUnit]
    });
    
    res.json({
      success: true,
      message: 'Пользователь создан успешно',
      user: createdUser
    });
    
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 15. ОБНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
app.put('/api/users/:id', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const { fio, password, email, role, resId } = req.body;
    
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Обновляем только переданные поля
    const updateData = {};
    if (fio) updateData.fio = fio;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (role === 'admin') {
      updateData.resId = null;
    } else if (resId !== undefined) {
      updateData.resId = resId;
    }
    
    // Если передан новый пароль
    if (password && password.length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
      }
      updateData.password = password;
    }
    
    await user.update(updateData);
    
    const updatedUser = await User.findByPk(userId, {
      attributes: ['id', 'fio', 'login', 'role', 'resId', 'email'],
      include: [ResUnit]
    });
    
    res.json({
      success: true,
      message: 'Пользователь обновлен успешно',
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 16. УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
app.delete('/api/users/:id', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const { password } = req.body;
    
    // Проверка пароля
    if (password !== DELETE_PASSWORD) {
      return res.status(403).json({ error: 'Неверный пароль' });
    }
    
    // Нельзя удалить себя
    if (userId == req.user.id) {
      return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
    }
    
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Проверяем, не последний ли это админ
    if (user.role === 'admin') {
      const adminCount = await User.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
      }
    }
    
    await user.destroy();
    
    res.json({
      success: true,
      message: 'Пользователь удален'
    });
    
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// API ДЛЯ ПРОБЛЕМНЫХ ВЛ
// =====================================================

// Получение списка проблемных ВЛ
app.get('/api/problem-vl/list', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const problemVLs = await ProblemVL.findAll({
        where: { status: 'active' },
        include: [ResUnit, NetworkStructure],
        order: [['failureCount', 'DESC'], ['lastErrorDate', 'DESC']]
      });
      res.json(problemVLs);
    } catch (error) {
      console.error('Get problem VLs error:', error);
      res.status(500).json({ error: error.message });
    }
});

// Отклонение проблемы
app.put('/api/problem-vl/:id/dismiss', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      await ProblemVL.update(
        { status: 'dismissed' },
        { where: { id: req.params.id } }
      );
      
      // Удаляем связанные уведомления
      await Notification.destroy({
        where: {
          type: 'problem_vl',
          message: {
            [Op.like]: `%"puNumber":"${req.params.id}"%`
          }
        }
      });
      
      res.json({ success: true, message: 'Проблема отклонена' });
    } catch (error) {
      console.error('Dismiss problem VL error:', error);
      res.status(500).json({ error: error.message });
    }
});
// отправка писем ENDPOINT :
app.post('/api/problem-vl/:id/send-email', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const problemVL = await ProblemVL.findByPk(req.params.id, {
        include: [ResUnit]
      });
      
      if (!problemVL) {
        return res.status(404).json({ error: 'Проблема не найдена' });
      }
      
      // Находим ответственных за РЭС
      const responsibleUsers = await User.findAll({
        where: {
          resId: problemVL.resId,
          role: 'res_responsible'
        }
      });
      
      if (responsibleUsers.length === 0) {
        return res.status(400).json({ error: 'Не найден ответственный для этого РЭС' });
      }
      
      // Здесь можно добавить отправку реального email через nodemailer
      // Пока просто создадим уведомление
      
      for (const user of responsibleUsers) {
        await Notification.create({
          fromUserId: req.user.id,
          toUserId: user.id,
          resId: problemVL.resId,
          type: 'info',
          message: `⚠️ Требуется объяснительная записка по проблемному ПУ №${problemVL.puNumber} (${problemVL.tpName} - ${problemVL.vlName}). Количество неудачных проверок: ${problemVL.failureCount}`,
          isRead: false
        });
      }
      
      res.json({ success: true, message: 'Уведомление отправлено' });
      
    } catch (error) {
      console.error('Send email error:', error);
      res.status(500).json({ error: error.message });
    }
});
// =====================================================
// Отчет по проблемным ВЛ
// =====================================================
app.get('/api/reports/problem-vl', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      
      let whereClause = {};
      if (dateFrom || dateTo) {
        whereClause.lastErrorDate = {};
        if (dateFrom) whereClause.lastErrorDate[Op.gte] = new Date(dateFrom);
        if (dateTo) {
          const endDate = new Date(dateTo);
          endDate.setHours(23, 59, 59, 999);
          whereClause.lastErrorDate[Op.lte] = endDate;
        }
      }
      
      // Добавляем фильтр по РЭС для не-админов
      if (req.user.role !== 'admin') {
        whereClause.resId = req.user.resId;
      }
      
      const problemVLs = await ProblemVL.findAll({
        where: whereClause,
        include: [ResUnit],
        order: [['failureCount', 'DESC']]
      });
      
      const reportData = problemVLs.map(p => ({
        resName: p.ResUnit?.name,
        tpName: p.tpName,
        vlName: p.vlName,
        position: p.position === 'start' ? 'Начало' : p.position === 'middle' ? 'Середина' : 'Конец',
        puNumber: p.puNumber,
        failureCount: p.failureCount,
        firstReportDate: p.firstReportDate,
        lastErrorDate: p.lastErrorDate,
        lastErrorDetails: p.lastErrorDetails,
        status: p.status === 'active' ? 'Активная' : p.status === 'resolved' ? 'Решена' : 'Отклонена'
      }));
      
      res.json(reportData);
    } catch (error) {
      console.error('Problem VL report error:', error);
      res.status(500).json({ error: error.message });
    }
});
// Получение количества непрочитанных уведомлений
app.get('/api/notifications/counts', authenticateToken, async (req, res) => {
  try {
    let whereClause = {};
    
    if (req.user.role === 'admin') {
      whereClause = {};
    } else if (req.user.role === 'res_responsible') {
      whereClause = {
        resId: req.user.resId,
        [Op.or]: [
          { toUserId: null },
          { toUserId: req.user.id }
        ]
      };
    } else {
      whereClause = { 
        toUserId: req.user.id
      };
    }
    
    // Для проблемных ВЛ считаем только активные
    let problemVLCount = 0;
    if (req.user.role === 'admin') {
      problemVLCount = await ProblemVL.count({
        where: { status: 'active' }  // Только активные!
      });
    }
    
    // Получаем все доступные уведомления
    const allNotifications = await Notification.findAll({
      where: whereClause,
      attributes: ['id', 'type']
    });
    
    // Получаем прочитанные текущим пользователем
    const readNotifications = await NotificationRead.findAll({
      where: {
        userId: req.user.id,
        notificationId: {
          [Op.in]: allNotifications.map(n => n.id)
        }
      },
      attributes: ['notificationId']
    });
    
    const readIds = new Set(readNotifications.map(r => r.notificationId));
    
    // Считаем непрочитанные по типам
    let techPending = 0;
    let askuePending = 0;
    
    allNotifications.forEach(notif => {
      if (!readIds.has(notif.id)) {
        if (notif.type === 'error') techPending++;
        else if (notif.type === 'pending_askue') askuePending++;
      }
    });
    
    res.json({
      tech_pending: techPending,
      askue_pending: askuePending,
      problem_vl: problemVLCount  // Используем подсчет из ProblemVL
    });
  } catch (error) {
    console.error('Error counting notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// роут Отметить уведомления как прочитанные
app.put('/api/notifications/mark-read', authenticateToken, async (req, res) => {
  try {
    const { type } = req.body;
    let whereClause = {};
    
    // Определяем какие уведомления должны быть помечены
    if (req.user.role === 'admin') {
      whereClause = type === 'all' ? {} : { type };
    } else if (req.user.role === 'res_responsible') {
      whereClause = {
        resId: req.user.resId,
        [Op.or]: [
          { toUserId: null },
          { toUserId: req.user.id }
        ]
      };
      if (type !== 'all') whereClause.type = type;
    } else {
      whereClause = { toUserId: req.user.id };
      if (type !== 'all') whereClause.type = type;
    }
    
    // Получаем все уведомления для пометки
    const notificationsToMark = await Notification.findAll({
      where: whereClause,
      attributes: ['id']
    });
    
    // Создаем записи о прочтении
    const readRecords = notificationsToMark.map(notif => ({
      notificationId: notif.id,
      userId: req.user.id,
      readAt: new Date()
    }));
    
    // Массовое создание с игнорированием дубликатов
    await NotificationRead.bulkCreate(readRecords, {
      ignoreDuplicates: true // игнорируем если уже прочитано
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API для массового удаления записей
app.post('/api/documents/delete-bulk', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { ids, password } = req.body;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Не выбраны записи для удаления' });
      }
      
      // Получаем все записи для удаления
      const records = await CheckHistory.findAll({
        where: { id: { [Op.in]: ids } },
        transaction
      });
      
      // Удаляем все файлы из Cloudinary
      for (const record of records) {
        if (record.attachments && record.attachments.length > 0) {
          for (const file of record.attachments) {
            try {
              await cloudinary.uploader.destroy(file.public_id);
              console.log(`Deleted file from Cloudinary: ${file.public_id}`);
            } catch (err) {
              console.error('Error deleting file from Cloudinary:', err);
            }
          }
        }
      }
      
      // Удаляем записи из БД
      const deletedCount = await CheckHistory.destroy({
        where: { id: { [Op.in]: ids } },
        transaction
      });
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: `Удалено записей: ${deletedCount}`,
        deletedCount
      });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Bulk delete error:', error);
      res.status(500).json({ error: error.message });
    }
});

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ АНАЛИЗА
// =====================================================

async function analyzeFile(filePath, type, originalFileName = null, requiredPeriod = null, userId = null) {
  return new Promise((resolve, reject) => {

    console.log('=== ANALYZE FILE DEBUG ===');
    console.log('Received userId:', userId);
    console.log('All params:', { filePath, type, originalFileName, requiredPeriod, userId });
    
    // Вспомогательная функция для получения названия месяца
    function getMonthName(monthNum) {
      const months = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
      return months[monthNum] || '';
    }
    
    // Функция для извлечения периода из текста ошибки
    function extractPeriodFromError(errorText) {
      const monthMap = {
        'Янв': 1, 'Фев': 2, 'Мар': 3, 'Апр': 4, 'Май': 5, 'Июн': 6,
        'Июл': 7, 'Авг': 8, 'Сен': 9, 'Окт': 10, 'Ноя': 11, 'Дек': 12
      };
      
      const monthPattern = /(Янв|Фев|Мар|Апр|Май|Июн|Июл|Авг|Сен|Окт|Ноя|Дек)/g;
      const foundMonths = errorText.match(monthPattern);
      
      if (foundMonths && foundMonths.length > 0) {
        const firstMonth = monthMap[foundMonths[0]];
        const lastMonth = monthMap[foundMonths[foundMonths.length - 1]];
        const currentYear = new Date().getFullYear();
        
        return {
          start: new Date(currentYear, firstMonth - 1, 1),
          end: new Date(currentYear, lastMonth - 1, 28)
        };
      }
      
      return null;
    }
    
    let scriptPath;
    const analyzersDir = path.join(process.cwd(), 'analyzers');
    
    switch(type) {
      case 'rim_single':
        scriptPath = path.join(analyzersDir, 'rim_converter_csv.py');
        break;
      case 'rim_mass':
        scriptPath = path.join(analyzersDir, 'rim_mass_analyzer.py');
        break;
      case 'nartis':
        scriptPath = path.join(analyzersDir, 'nartis_analyzer.py');
        break;
      case 'energomera':
        scriptPath = path.join(analyzersDir, 'energomera_analyzer.py');
        break;
      default:
        return resolve({
          processed: [],
          errors: ['Неизвестный тип анализатора']
        });
    }
    
    // Проверки существования директории и скрипта
    if (!fs.existsSync(analyzersDir)) {
      console.error('Analyzers directory not found:', analyzersDir);
      return resolve({
        processed: [],
        errors: [`Директория analyzers не найдена`]
      });
    }
    
    if (!fs.existsSync(scriptPath)) {
      console.error('Python script not found:', scriptPath);
      return resolve({
        processed: [],
        errors: [`Python скрипт не найден: ${scriptPath}`]
      });
    }
    
    // Запуск Python
    let python;
    try {
      python = spawn('python3', [scriptPath, filePath]);
      console.log('Python3 spawn created successfully');
    } catch (err) {
      console.error('Failed to spawn python3, trying python:', err);
      try {
        python = spawn('python', [scriptPath, filePath]);
        console.log('Python spawn created successfully');
      } catch (err2) {
        console.error('Both python3 and python failed:', err2);
        return resolve({
          processed: [],
          errors: ['Python не установлен на сервере. Убедитесь что в Build Command есть: npm install && pip install xlrd']
        });
      }
    }

    console.log('Running Python script:', scriptPath);
    console.log('Analyzing file:', filePath);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
      console.log('Python stdout chunk:', data.toString());
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('Python stderr:', data.toString());
    });

    python.on('error', (error) => {
      console.error('Python process error:', error);
      return resolve({
        processed: [],
        errors: [`Python не установлен или недоступен. Убедитесь что в Build Command на Render есть: npm install && pip install xlrd`]
      });
    });

    python.on('close', async (code) => {
      console.log('Python process closed with code:', code);
      
      if (code !== 0) {
        return resolve({
          processed: [],
          errors: [`Ошибка анализа (код ${code}): ${errorOutput}`]
        });
      }
      
      try {
        // Парсим результат от Python
        const result = JSON.parse(output);
        console.log('Parsed result:', JSON.stringify(result));
        
        if (result.success) {
          const processed = [];
          const errors = [];
          
          // Извлекаем номер ПУ из имени файла
          const fileName = originalFileName 
            ? path.basename(originalFileName, path.extname(originalFileName))
            : path.basename(filePath, path.extname(filePath));
          
          console.log('Extracted PU number from filename:', fileName);

          if (!fileName || fileName === 'undefined' || fileName === '') {
  console.error('ERROR: Invalid PU number');
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Error deleting file:', err);
  }
  
  return resolve({
    processed: [],
    errors: [],
    success: false,
    message: 'Ошибка: не удалось определить номер ПУ из имени файла'
  });
}
          
          // НОВАЯ ПРОВЕРКА: История загрузок
          const recentUploads = await PuUploadHistory.findAll({
  where: {
    puNumber: fileName,
    uploadedAt: {
      [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // последние 30 дней
    }
  },
  order: [['uploadedAt', 'DESC']]
});

// Извлекаем период из текущего файла
const currentPeriod = result.has_errors ? extractPeriodFromError(result.summary) : null;

// Проверяем дубликаты ТОЛЬКО если текущий файл с ошибкой
if (result.has_errors) {
  // Ищем такую же ошибку в истории
  const sameErrorUpload = recentUploads.find(upload => 
    upload.errorSummary === result.summary && upload.hasErrors
  );
  
  if (sameErrorUpload) {
    console.log(`Found same error in history for PU ${fileName}, checking if it was fixed...`);
    
    // Проверяем, была ли загрузка БЕЗ ошибок после этой ошибки
    const successfulUploadAfter = recentUploads.find(upload => 
      !upload.hasErrors && 
      new Date(upload.uploadedAt) > new Date(sameErrorUpload.uploadedAt)
    );
    
    if (successfulUploadAfter) {
      // Ошибка была исправлена, но теперь появилась снова
      console.log(`Error was fixed on ${successfulUploadAfter.uploadedAt} but now appeared again`);
      // Разрешаем загрузку - это повторное появление ошибки
    } else {
      // Ошибка не была исправлена - это дубликат
      console.log(`DUPLICATE: Same error still not fixed for PU ${fileName}`);
      
      // Записываем попытку загрузки дубликата
      if (userId) {
        await PuUploadHistory.create({
          puNumber: fileName,
          uploadedBy: userId,
          fileName: originalFileName || 'unknown',
          fileType: type,
          periodStart: currentPeriod?.start,
          periodEnd: currentPeriod?.end,
          hasErrors: result.has_errors,
          errorSummary: result.summary,
          errorDetails: result.details,
          uploadStatus: 'duplicate'
        });
      }
      
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
      
      return resolve({
        processed: [{
          puNumber: fileName,
          status: 'duplicate_error',
          error: `❌ Данная ошибка уже была загружена ${new Date(sameErrorUpload.uploadedAt).toLocaleDateString('ru-RU')}! Проверьте статус обработки.`
        }],
        errors: []
      });
    }
  }
  
  // Дополнительная проверка: есть ли активные уведомления или записи в CheckHistory
  const activeCheckHistory = await CheckHistory.findOne({
    where: { 
      puNumber: fileName,
      initialError: result.summary,
      status: ['awaiting_work', 'awaiting_recheck']
    }
  });
  
  if (activeCheckHistory) {
    console.log(`DUPLICATE: Active CheckHistory record exists for this error`);
    
    if (userId) {
      await PuUploadHistory.create({
        puNumber: fileName,
        uploadedBy: userId,
        fileName: originalFileName || 'unknown',
        fileType: type,
        periodStart: currentPeriod?.start,
        periodEnd: currentPeriod?.end,
        hasErrors: result.has_errors,
        errorSummary: result.summary,
        errorDetails: result.details,
        uploadStatus: 'duplicate'
      });
    }
    
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Error deleting file:', err);
    }
    
    return resolve({
      processed: [{
        puNumber: fileName,
        status: 'duplicate_error',
        error: '❌ Данная ошибка уже находится в обработке!'
      }],
      errors: []
    });
  }
}
          
          // Ищем ПУ в структуре сети
          const networkStructure = await NetworkStructure.findOne({
            where: {
              [Op.or]: [
                { startPu: fileName },
                { endPu: fileName },
                { middlePu: fileName }
              ]
            },
            include: [ResUnit]
          });
          
          if (networkStructure) {
            console.log(`Found network structure for PU ${fileName}: TP=${networkStructure.tpName}, VL=${networkStructure.vlName}`);
            
            // Определяем позицию
            let position = 'start';
            if (networkStructure.endPu === fileName) position = 'end';
            else if (networkStructure.middlePu === fileName) position = 'middle';
            
            console.log(`PU position: ${position}`);
            
            // Проверяем последнюю запись в истории
            const lastCheckHistory = await CheckHistory.findOne({
              where: { 
                puNumber: fileName,
                [Op.or]: [
                  { status: 'awaiting_work' },
                  { status: 'awaiting_recheck' },
                  { status: 'completed' }
                ]
              },
              order: [['createdAt', 'DESC']]
            });
            
            // ПРОВЕРКА 1: Это перепроверка?
            if (lastCheckHistory && lastCheckHistory.status === 'awaiting_recheck') {
              console.log(`This is a recheck for PU ${fileName}`);
              
              // ПРОВЕРКА ПЕРИОДА при перепроверке
              if (result.has_errors) {
                // Сначала проверим дату
                const checkFromDate = lastCheckHistory.workCompletedDate;
                if (checkFromDate) {
                  const requiredDate = new Date(checkFromDate);
                  const requiredMonth = requiredDate.getMonth() + 1;
                  const requiredYear = requiredDate.getFullYear();
                  
                  const errorText = result.summary;
                  const monthMap = {
                    'Янв': 1, 'Фев': 2, 'Мар': 3, 'Апр': 4, 'Май': 5, 'Июн': 6,
                    'Июл': 7, 'Авг': 8, 'Сен': 9, 'Окт': 10, 'Ноя': 11, 'Дек': 12
                  };
                  
                  const monthPattern = /(Янв|Фев|Мар|Апр|Май|Июн|Июл|Авг|Сен|Окт|Ноя|Дек)/g;
                  const foundMonths = errorText.match(monthPattern);
                  
                  if (foundMonths && foundMonths.length > 0) {
                    const lastErrorMonth = foundMonths[foundMonths.length - 1];  // последний месяц в журнале
                    const lastErrorMonthNum = monthMap[lastErrorMonth];
  
                    // Журнал должен включать данные ПОСЛЕ месяца выполнения работ
                    if (lastErrorMonthNum < requiredMonth) {  // если последний месяц раньше требуемого
                      console.log(`PERIOD MISMATCH: Required from month ${requiredMonth}, but journal ends at month ${lastErrorMonthNum}`);
    
                      return resolve({
                        processed: [{
                          puNumber: fileName,
                          status: 'wrong_period',
                          error: `❌ Неверный период! Требуется журнал событий с ${requiredDate.toLocaleDateString('ru-RU')} по текущую дату. Журнал должен включать данные после ${getMonthName(requiredMonth)} ${requiredYear}!`
                        }],
                        errors: []
                      });
                    }
                  }
                }
              }
              
              // Удаляем уведомления АСКУЭ в любом случае
              await Notification.destroy({
                where: {
                  type: 'pending_askue',
                  message: {
                    [Op.like]: `%"puNumber":"${fileName}"%`
                  }
                }
              });
              console.log('Deleted ASKUE notifications');
              
              // ОБРАБОТКА РЕЗУЛЬТАТА ПЕРЕПРОВЕРКИ
              if (!result.has_errors) {
                // УСПЕШНАЯ перепроверка
                console.log(`Recheck successful - errors fixed for PU ${fileName}`);
                
                // Обновляем историю
                await CheckHistory.update({
                  recheckDate: new Date(),
                  recheckResult: 'ok',
                  status: 'completed'
                }, {
                  where: {
                    puNumber: fileName,
                    status: 'awaiting_recheck'
                  }
                });
                
                // Обновляем статус ПУ
                await PuStatus.update({
                  status: 'checked_ok',
                  errorDetails: null,
                  lastCheck: new Date()
                }, {
                  where: { puNumber: fileName }
                });
                
                // Решаем проблемную ВЛ если была
                await ProblemVL.update(
                  { status: 'resolved' },
                  { where: { puNumber: fileName, status: 'active' } }
                );
                
                // Создаем успешное уведомление для всех ответственных РЭС
                await Notification.create({
                  fromUserId: 1,
                  toUserId: null, // для всех ответственных РЭС
                  resId: networkStructure.resId,
                  networkStructureId: networkStructure.id,
                  type: 'success',
                  message: `✅ Проблема с ПУ ${fileName} (${networkStructure.tpName} - ${networkStructure.vlName}) успешно устранена!`,
                  isRead: false
                });
                
              } else {
                // НЕУСПЕШНАЯ перепроверка
                console.log(`Recheck failed - errors still present for PU ${fileName}`);
                
                const newFailureCount = (lastCheckHistory.failureCount || 1) + 1;
                
                // Обновляем историю
                await CheckHistory.update({
                  recheckDate: new Date(),
                  recheckResult: 'error',
                  status: 'awaiting_work', // Возвращаем в работу!
                  failureCount: newFailureCount
                }, {
                  where: {
                    puNumber: fileName,
                    status: 'awaiting_recheck'
                  }
                });
                
                // Обновляем статус ПУ
                await PuStatus.update({
                  status: 'checked_error',
                  errorDetails: result.summary,
                  lastCheck: new Date()
                }, {
                  where: { puNumber: fileName }
                });
                
                // Создаем уведомление об ошибке для РЭС
                await Notification.create({
                  fromUserId: 1,
                  toUserId: null, // для всех ответственных РЭС
                  resId: networkStructure.resId,
                  networkStructureId: networkStructure.id,
                  type: 'error',
                  message: JSON.stringify({
                    puNumber: fileName,
                    position: position,
                    tpName: networkStructure.tpName,
                    vlName: networkStructure.vlName,
                    resName: networkStructure.ResUnit.name,
                    errorDetails: result.summary,
                    details: result.details
                  }),
                  isRead: false
                });
                console.log('Created error notification for RES after failed recheck');
                
                // Проверяем на проблемную ВЛ (2+ ошибки)
                if (newFailureCount >= 2) {
                  const [problemVL, created] = await ProblemVL.findOrCreate({
                    where: { 
                      puNumber: fileName,
                      status: 'active'
                    },
                    defaults: {
                      networkStructureId: networkStructure.id,
                      resId: networkStructure.resId,
                      tpName: networkStructure.tpName,
                      vlName: networkStructure.vlName,
                      position: position,
                      puNumber: fileName,
                      failureCount: newFailureCount,
                      lastErrorDate: new Date(),
                      lastErrorDetails: result.summary,
                      firstReportDate: lastCheckHistory.initialCheckDate,
                      resComment: lastCheckHistory.resComment
                    }
                  });
                  
                  if (!created) {
                    await problemVL.update({
                      failureCount: newFailureCount,
                      lastErrorDate: new Date(),
                      lastErrorDetails: result.summary
                    });
                  }
                  
                  // Уведомление админам о проблемной ВЛ
                  const admins = await User.findAll({ where: { role: 'admin' } });
                  for (const admin of admins) {
                    await Notification.create({
                      fromUserId: 1,
                      toUserId: admin.id,
                      resId: networkStructure.resId,
                      networkStructureId: networkStructure.id,
                      type: 'problem_vl',
                      message: JSON.stringify({
                        tpName: networkStructure.tpName,
                        vlName: networkStructure.vlName,
                        puNumber: fileName,
                        position: position,
                        failureCount: newFailureCount,
                        errorDetails: result.summary,
                        resComment: lastCheckHistory.resComment,
                        resName: networkStructure.ResUnit.name
                      }),
                      isRead: false
                    });
                  }
                  console.log('Created problem VL notification for admins');
                }
              }
              
            } else {
              // НЕ ПЕРЕПРОВЕРКА - обычная проверка или повторная проверка
              
              // Обновляем статус ПУ
              await PuStatus.upsert({
                puNumber: fileName,
                networkStructureId: networkStructure.id,
                position: position,
                status: result.has_errors ? 'checked_error' : 'checked_ok',
                errorDetails: result.has_errors ? result.summary : null,
                lastCheck: new Date()
              });
              
              // Если есть ошибки - добавляем для создания уведомлений
              if (result.has_errors) {
                errors.push({
                  puNumber: fileName,
                  error: result.summary,
                  details: result.details,
                  networkStructureId: networkStructure.id,
                  resId: networkStructure.resId
                });
                console.log('Added error for notification creation');
              }
            }
            
            // Записываем успешную загрузку в историю
            if (userId) {
                console.log('=== CREATING PuUploadHistory ===');
                console.log('userId:', userId);
                console.log('Data to save:', {
                  puNumber: fileName,
                  uploadedBy: userId,
                  fileName: originalFileName || 'unknown',
                  fileType: type,
                  uploadStatus: 'success'
                });
  
                try {
                  const record = await PuUploadHistory.create({
                    puNumber: fileName,
                    uploadedBy: userId,
                    fileName: originalFileName || 'unknown',
                    fileType: type,
                    periodStart: currentPeriod?.start,
                    periodEnd: currentPeriod?.end,
                    hasErrors: result.has_errors,
                    errorSummary: result.has_errors ? result.summary : null,
                    errorDetails: result.has_errors ? result.details : null,
                    uploadStatus: 'success'
                  });
                  console.log('✅ PuUploadHistory created:', record.id);
                } catch (error) {
                  console.error('❌ Error creating PuUploadHistory:', error);
                }
              } else {
                console.log('⚠️ No userId provided, skipping history save');
              }
            
            // Добавляем в processed
            processed.push({
              puNumber: fileName,
              status: result.has_errors ? 'checked_error' : 'checked_ok',
              error: result.has_errors ? result.summary : null
            });
            
          } else {
            // ПУ не найден в структуре сети
            console.log(`WARNING: NetworkStructure not found for PU: ${fileName}`);
            processed.push({
              puNumber: fileName,
              status: 'not_in_structure',
              error: 'ПУ не найден в структуре сети'
            });
          }
          
          // Удаляем временный файл
          try {
            fs.unlinkSync(filePath);
            console.log('Temporary file deleted');
          } catch (err) {
            console.error('Error deleting file:', err);
          }
          
          console.log(`Analysis complete: processed=${processed.length}, errors=${errors.length}`);
          resolve({ processed, errors });
          
        } else {
          console.error('Python script returned success=false:', result.error);
          resolve({
            processed: [],
            errors: [result.error || 'Неизвестная ошибка Python скрипта']
          });
        }
      } catch (e) {
        console.error('Failed to parse Python output:', e);
        console.error('Raw output was:', output);
        resolve({
          processed: [],
          errors: [`Ошибка парсинга результата: ${e.message}`]
        });
      }
    });
  });
}

// Создание уведомлений об ошибках
async function createNotifications(fromUserId, resId, errors) {
  console.log('Creating notifications for errors:', errors);
  
  for (const errorInfo of errors) {
    console.log(`Processing error for PU: ${errorInfo.puNumber}`);
    
    // Находим структуру сети для этого ПУ
    const networkStructure = await NetworkStructure.findOne({
      where: {
        [Op.or]: [
          { startPu: errorInfo.puNumber },
          { middlePu: errorInfo.puNumber },
          { endPu: errorInfo.puNumber }
        ]
      },
      include: [ResUnit]
    });
    
    if (!networkStructure) {
      console.log(`WARNING: No network structure found for PU ${errorInfo.puNumber}`);
      continue;
    }
    
    console.log(`NetworkStructure found: TP=${networkStructure.tpName}, VL=${networkStructure.vlName}`);
    
    // Определяем позицию ПУ
    let position = 'start';
    if (networkStructure.middlePu === errorInfo.puNumber) position = 'middle';
    else if (networkStructure.endPu === errorInfo.puNumber) position = 'end';
    
    // Формируем данные для уведомления с полными деталями
    const errorData = {
      puNumber: errorInfo.puNumber,
      position: position,
      tpName: networkStructure.tpName,
      vlName: networkStructure.vlName,
      resName: networkStructure.ResUnit.name,
      errorDetails: errorInfo.error,
      details: errorInfo.details  // Важно для определения фаз!
    };
    
    console.log('Creating notification with data:', errorData);
    
    // СОЗДАЕМ ТОЛЬКО ОДНО УВЕДОМЛЕНИЕ БЕЗ ПРИВЯЗКИ К КОНКРЕТНОМУ ПОЛЬЗОВАТЕЛЮ!
    try {
      const notification = await Notification.create({
        fromUserId,
        toUserId: null, // НЕ привязываем к конкретному пользователю!
        resId,
        networkStructureId: networkStructure.id,
        type: 'error',
        message: JSON.stringify(errorData),
        isRead: false
      });
      console.log(`Notification created for RES ${resId}`);
    } catch (err) {
      console.error(`Failed to create notification:`, err);
    }
  }
  
  console.log('All notifications created');
}

// =====================================================
// ИНИЦИАЛИЗАЦИЯ БД И ЗАПУСК СЕРВЕРА
// =====================================================

async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    
    // Синхронизация моделей
    await sequelize.sync({ alter: true });
    console.log('All models synchronized');
    
    // Создаем РЭСы если их нет
    const resCount = await ResUnit.count();
    if (resCount === 0) {
      const resList = [
        'Краснополянский РЭС',
        'Адлерский РЭС',
        'Хостинский РЭС',
        'Сочинский РЭС',
        'Дагомысский РЭС',
        'Лазаревский РЭС',
        'Туапсинский РЭС'
      ];
      
      for (const resName of resList) {
        await ResUnit.create({ name: resName });
      }
      console.log('RES units created');
    }
    
    // Создаем СИРИУС
    try {
      const [sirius, created] = await ResUnit.findOrCreate({
        where: { name: 'СИРИУС' },
        defaults: { name: 'СИРИУС' }
      });
      console.log('SIRIUS', created ? 'created' : 'already exists');
    } catch (err) {
      console.error('Error creating SIRIUS:', err);
    }
    
    console.log('Database initialization complete');
    
    // Создаем админа если его нет
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      await User.create({
        fio: 'Администратор',
        login: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@res.ru'
      });
      console.log('Admin user created');
    }
    
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
}


// API для получения документов
app.get('/api/documents/list', authenticateToken, async (req, res) => {
  try {
    let whereClause = {};
    
    // Фильтрация по РЭС для не-админов
    if (req.user.role !== 'admin') {
      whereClause.resId = req.user.resId;
    }
    
    const documents = await CheckHistory.findAll({
      where: whereClause,
      include: [ResUnit],
      order: [['workCompletedDate', 'DESC']]
    });
    
    // Фильтруем только записи с файлами
    const documentsWithFiles = documents.filter(doc => 
      doc.attachments && 
      Array.isArray(doc.attachments) && 
      doc.attachments.length > 0
    );
    
    const formattedDocs = documentsWithFiles.map(doc => ({
      id: doc.id,
      tpName: doc.tpName,
      vlName: doc.vlName,
      puNumber: doc.puNumber,
      uploadedBy: doc.ResUnit?.name || 'Неизвестно',
      workCompletedDate: doc.workCompletedDate,
      resComment: doc.resComment,
      status: doc.status,
      attachments: doc.attachments || []
    }));
    
    res.json(formattedDocs);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API для управления файлами 
app.get('/api/admin/files', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      // Получаем ВСЕ записи без проблемного where
      const records = await CheckHistory.findAll({
        include: [ResUnit],
        order: [['createdAt', 'DESC']]
      });
      
      // Фильтруем в JavaScript
      const recordsWithFiles = records.filter(record => 
        record.attachments && 
        Array.isArray(record.attachments) && 
        record.attachments.length > 0
      );
      
      // Собираем все файлы
      const files = [];
      recordsWithFiles.forEach(record => {
        if (record.attachments && Array.isArray(record.attachments)) {
          record.attachments.forEach(file => {
            files.push({
              ...file,
              recordId: record.id,
              resName: record.ResUnit?.name,
              tpName: record.tpName,
              puNumber: record.puNumber,
              uploadDate: record.workCompletedDate || record.createdAt
            });
          });
        }
      });
      
      res.json({ files, total: files.length });
    } catch (error) {
      console.error('Error in /api/admin/files:', error);
      res.status(500).json({ error: error.message });
    }
  });

// API для удаления файла из документа
app.delete('/api/documents/record/:recordId', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      const { recordId } = req.params;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      const record = await CheckHistory.findByPk(recordId);
      if (!record) {
        return res.status(404).json({ error: 'Запись не найдена' });
      }
      
      // Удаляем все файлы из Cloudinary
      if (record.attachments && record.attachments.length > 0) {
        for (const file of record.attachments) {
          try {
            await cloudinary.uploader.destroy(file.public_id);
            console.log(`Deleted file from Cloudinary: ${file.public_id}`);
          } catch (err) {
            console.error('Error deleting file from Cloudinary:', err);
          }
        }
      }
      
      // Удаляем запись из БД
      await record.destroy();
      
      res.json({ 
        success: true, 
        message: 'Запись и все связанные файлы удалены' 
      });
      
    } catch (error) {
      console.error('Delete record error:', error);
      res.status(500).json({ error: error.message });
    }
});

// ИСПРАВЛЕННЫЙ эндпоинт для управления файлами в настройках
app.delete('/api/admin/files/:public_id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      const { public_id } = req.params;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      console.log(`Attempting to delete file with public_id: ${public_id}`);
      
      // Удаляем из Cloudinary
      await cloudinary.uploader.destroy(public_id);
      console.log('File deleted from Cloudinary');
      
      // Находим все записи в CheckHistory с этим файлом
      const records = await CheckHistory.findAll();
      let updatedCount = 0;
      
      for (const record of records) {
        if (record.attachments && Array.isArray(record.attachments)) {
          const originalLength = record.attachments.length;
          const newAttachments = record.attachments.filter(
            file => file.public_id !== public_id
          );
          
          if (newAttachments.length < originalLength) {
            await record.update({ attachments: newAttachments });
            updatedCount++;
          }
        }
      }
      
      console.log(`Updated ${updatedCount} records`);
      
      res.json({ 
        success: true, 
        message: 'Файл удален',
        updatedRecords: updatedCount
      });
      
    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('Features enabled:');
    console.log('- User Management ✓');
    console.log('- Phase Detection ✓'); 
    console.log('- Auto Updates ✓');
    console.log('- Auto Hide Notifications ✓');
  });
});

// Обработка ошибок
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

// API для получения истории загрузок по конкретному ПУ
app.get('/api/history/uploads/:puNumber', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { puNumber } = req.params;
      
      const uploads = await PuUploadHistory.findAll({
        where: { puNumber },
        include: [{
          model: User,
          attributes: ['fio', 'login']
        }],
        order: [['uploadedAt', 'DESC']],
        limit: 20
      });
      
      res.json(uploads);
    } catch (error) {
      console.error('Get upload history error:', error);
      res.status(500).json({ error: error.message });
    }
});

// API для получения истории проверок по конкретному ПУ
app.get('/api/history/checks/:puNumber', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { puNumber } = req.params;
      
      const checks = await CheckHistory.findAll({
        where: { puNumber },
        include: [ResUnit],
        order: [['createdAt', 'DESC']]
      });
      
      res.json(checks);
    } catch (error) {
      console.error('Get check history error:', error);
      res.status(500).json({ error: error.message });
    }
});

// API для получения всей истории загрузок с фильтрами
app.get('/api/history/uploads', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { resId, tpName, puNumber, dateFrom, dateTo, fileType, status, page = 1, limit = 50 } = req.query;
      
      // Сначала получаем все PU для нужного РЭС
      let structureWhere = {};
      
      // Фильтр по РЭС
      if (req.user.role === 'admin' && resId) {
        structureWhere.resId = resId;
      } else if (req.user.role !== 'admin') {
        structureWhere.resId = req.user.resId;
      }
      
      // Фильтр по ТП если указан
      if (tpName) {
        structureWhere.tpName = { [Op.like]: `%${tpName}%` };
      }
      
      // Получаем все номера ПУ из структуры с нужными фильтрами
      const structures = await NetworkStructure.findAll({
        where: structureWhere,
        attributes: ['startPu', 'middlePu', 'endPu', 'tpName', 'vlName', 'resId'],
        include: [ResUnit]
      });
      
      // Собираем все номера ПУ
      const puNumbers = new Set();
      const puToStructureMap = {};
      
      structures.forEach(s => {
        if (s.startPu) {
          puNumbers.add(s.startPu);
          puToStructureMap[s.startPu] = s;
        }
        if (s.middlePu) {
          puNumbers.add(s.middlePu);
          puToStructureMap[s.middlePu] = s;
        }
        if (s.endPu) {
          puNumbers.add(s.endPu);
          puToStructureMap[s.endPu] = s;
        }
      });
      
      // Если нет ПУ для этого РЭС - возвращаем пустой результат
      if (puNumbers.size === 0) {
        return res.json({
          uploads: [],
          total: 0,
          page: parseInt(page),
          totalPages: 0
        });
      }
      
      // Теперь ищем загрузки только для этих ПУ
      let uploadWhere = {
        puNumber: Array.from(puNumbers)
      };
      
      // Дополнительные фильтры
      if (puNumber) {
        uploadWhere.puNumber = { 
          [Op.and]: [
            { [Op.in]: Array.from(puNumbers) },
            { [Op.like]: `%${puNumber}%` }
          ]
        };
      }
      if (fileType) uploadWhere.fileType = fileType;
      if (status) uploadWhere.uploadStatus = status;
      
      if (dateFrom || dateTo) {
        uploadWhere.uploadedAt = {};
        if (dateFrom) uploadWhere.uploadedAt[Op.gte] = new Date(dateFrom);
        if (dateTo) {
          const endDate = new Date(dateTo);
          endDate.setHours(23, 59, 59, 999);
          uploadWhere.uploadedAt[Op.lte] = endDate;
        }
      }
      
      const offset = (page - 1) * limit;
      
      const { count, rows } = await PuUploadHistory.findAndCountAll({
        where: uploadWhere,
        include: [{
          model: User,
          attributes: ['fio', 'login', 'resId'],
          include: [ResUnit]
        }],
        order: [['uploadedAt', 'DESC']],
        limit: parseInt(limit),
        offset
      });
      
      // Добавляем информацию о структуре
      const uploadsWithStructure = rows.map(upload => {
        const structure = puToStructureMap[upload.puNumber];
        return {
          ...upload.toJSON(),
          tpName: structure?.tpName,
          vlName: structure?.vlName,
          resName: structure?.ResUnit?.name,
          resId: structure?.resId
        };
      });
      
      res.json({
        uploads: uploadsWithStructure,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / limit)
      });
      
    } catch (error) {
      console.error('Get all uploads history error:', error);
      res.status(500).json({ error: error.message });
    }
});

// API для получения всей истории проверок
app.get('/api/history/checks', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { resId, tpName, puNumber, dateFrom, dateTo, status, page = 1, limit = 50 } = req.query;
      
      let whereClause = {};
      
      // Фильтры
      if (status) whereClause.status = status;
      if (puNumber) whereClause.puNumber = { [Op.like]: `%${puNumber}%` };
      if (tpName) whereClause.tpName = { [Op.like]: `%${tpName}%` };
      
      // ИСПРАВЛЕНО: Фильтр по РЭС
      if (req.user.role === 'admin' && resId) {
        whereClause.resId = resId;
      } else if (req.user.role !== 'admin') {
        whereClause.resId = req.user.resId;
      }
      
      if (dateFrom || dateTo) {
        whereClause.createdAt = {};
        if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
        if (dateTo) {
          const endDate = new Date(dateTo);
          endDate.setHours(23, 59, 59, 999);
          whereClause.createdAt[Op.lte] = endDate;
        }
      }
      
      const offset = (page - 1) * limit;
      
      const { count, rows } = await CheckHistory.findAndCountAll({
        where: whereClause,
        include: [ResUnit],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset
      });
      
      res.json({
        checks: rows,
        total: count,
        page: parseInt(page),
        totalPages: Math.ceil(count / limit)
      });
      
    } catch (error) {
      console.error('Get all checks history error:', error);
      res.status(500).json({ error: error.message });
    }
});
// Очистка истории по конкретному ПУ
app.delete('/api/history/clear-pu/:puNumber', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { password } = req.body;
      const { puNumber } = req.params;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      // Удаляем из PuUploadHistory
      const uploadsDeleted = await PuUploadHistory.destroy({
        where: { puNumber },
        transaction
      });
      
      // Удаляем из CheckHistory
      const checksDeleted = await CheckHistory.destroy({
        where: { puNumber },
        transaction
      });
      
      // Удаляем из PuStatus
      await PuStatus.update(
        { 
          status: 'not_checked',
          errorDetails: null,
          lastCheck: null
        },
        { 
          where: { puNumber },
          transaction
        }
      );
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: `История ПУ ${puNumber} очищена`,
        deleted: {
          uploads: uploadsDeleted,
          checks: checksDeleted
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// Очистка истории по ТП
app.post('/api/history/clear-tp', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { password, tpNames, resId } = req.body;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      // Находим все ПУ для выбранных ТП
      const structures = await NetworkStructure.findAll({
        where: {
          tpName: tpNames,
          resId: resId
        }
      });
      
      const puNumbers = [];
      structures.forEach(s => {
        if (s.startPu) puNumbers.push(s.startPu);
        if (s.middlePu) puNumbers.push(s.middlePu);
        if (s.endPu) puNumbers.push(s.endPu);
      });
      
      if (puNumbers.length === 0) {
        return res.json({
          success: true,
          message: 'Нет ПУ для очистки',
          deleted: { uploads: 0, checks: 0 }
        });
      }
      
      // Удаляем историю
      const uploadsDeleted = await PuUploadHistory.destroy({
        where: { puNumber: puNumbers },
        transaction
      });
      
      const checksDeleted = await CheckHistory.destroy({
        where: { puNumber: puNumbers },
        transaction
      });
      
      // Сбрасываем статусы
      await PuStatus.update(
        { 
          status: 'not_checked',
          errorDetails: null,
          lastCheck: null
        },
        { 
          where: { puNumber: puNumbers },
          transaction
        }
      );
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: `История для ${tpNames.length} ТП очищена`,
        deleted: {
          uploads: uploadsDeleted,
          checks: checksDeleted,
          puCount: puNumbers.length
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// Очистка всей истории
app.delete('/api/history/clear-all', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { password } = req.body;
      
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      // Удаляем всю историю
      const uploadsDeleted = await PuUploadHistory.destroy({
        where: {},
        transaction
      });
      
      const checksDeleted = await CheckHistory.destroy({
        where: {},
        transaction
      });
      
      // Сбрасываем все статусы
      await PuStatus.update(
        { 
          status: 'not_checked',
          errorDetails: null,
          lastCheck: null
        },
        { 
          where: {},
          transaction
        }
      );
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: 'Вся история очищена',
        deleted: {
          uploads: uploadsDeleted,
          checks: checksDeleted
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});
// Новый эндпоинт для аналитики
app.get('/api/analytics/summary', 
  authenticateToken, 
  async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      
      // Условие по РЭС
      let resCondition = {};
      if (req.user.role !== 'admin') {
        resCondition.id = req.user.resId;
      }
      
      // Получаем все РЭС (для админа все, для остальных - только их)
const resList = await ResUnit.findAll({
  where: resCondition,
  order: [['name', 'ASC']]
});

// Фильтруем СИРИУС
const filteredResList = resList.filter(res => res.name !== 'СИРИУС');

// Условие по дате
let dateCondition = {};
if (dateFrom || dateTo) {
  dateCondition.uploadedAt = {};
  if (dateFrom) dateCondition.uploadedAt[Op.gte] = new Date(dateFrom);
  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    dateCondition.uploadedAt[Op.lte] = endDate;
  }
}

// Собираем статистику для каждого РЭС
const analytics = await Promise.all(
  filteredResList.map(async (res) => {
          // 1. Считаем ТП и ПУ
          const structures = await NetworkStructure.findAll({
            where: { resId: res.id }
          });
          
          const tpCount = new Set(structures.map(s => s.tpName)).size;
          
          let totalPuCount = 0;
          const allPuNumbers = new Set();
          
          structures.forEach(s => {
            if (s.startPu) { totalPuCount++; allPuNumbers.add(s.startPu); }
            if (s.middlePu) { totalPuCount++; allPuNumbers.add(s.middlePu); }
            if (s.endPu) { totalPuCount++; allPuNumbers.add(s.endPu); }
          });
          
          // 2. Считаем загрузки в периоде
          const uploads = await PuUploadHistory.findAll({
            where: {
              puNumber: Array.from(allPuNumbers),
              ...dateCondition
            }
          });
          
          const uploadedCount = uploads.length;
          const okCount = uploads.filter(u => !u.hasErrors).length;
          const errorCount = uploads.filter(u => u.hasErrors).length;
          
          return {
            resId: res.id,
            resName: res.name,
            tpCount,
            totalPuCount,
            uploadedCount,
            okCount,
            errorCount,
            percentage: totalPuCount > 0 ? Math.round((uploadedCount / totalPuCount) * 100) : 0
          };
        })
      );
      
      // Итоги
      const totals = analytics.reduce((acc, curr) => ({
        tpCount: acc.tpCount + curr.tpCount,
        totalPuCount: acc.totalPuCount + curr.totalPuCount,
        uploadedCount: acc.uploadedCount + curr.uploadedCount,
        okCount: acc.okCount + curr.okCount,
        errorCount: acc.errorCount + curr.errorCount
      }), {
        tpCount: 0,
        totalPuCount: 0,
        uploadedCount: 0,
        okCount: 0,
        errorCount: 0
      });
      
      res.json({
        analytics,
        totals,
        period: {
          from: dateFrom,
          to: dateTo
        }
      });
      
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({ error: error.message });
    }
});
