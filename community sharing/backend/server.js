const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();

const openai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

function normalizeLocation(value) {
  return (value || "").trim().toLowerCase();
}

function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/* ---------------- SCHEMAS ---------------- */

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["owner", "borrower"], required: true },
    location: { type: String, required: true, trim: true, lowercase: true }
  },
  { timestamps: true }
);

const requestSchema = new mongoose.Schema(
  {
    borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    toolName: { type: String, required: true, trim: true },
    duration: { type: String, required: true, trim: true },
    pickupDate: { type: String, required: true },
    returnDate: { type: String, required: true },
    borrowerMessage: { type: String, default: "", trim: true },
    location: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: [
        "Pending",
        "Accepted",
        "Payment Created",
        "Payment Submitted",
        "Confirmed",
        "Borrowed",
        "Completed",
        "Rejected"
      ],
      default: "Pending"
    },
    acceptedOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedOwnerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

const verificationSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    videoUrl: { type: String, required: true }
  },
  { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true, unique: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    rentAmount: { type: Number, required: true },
    depositAmount: { type: Number, required: true },

    ownerUpiId: { type: String, required: true, trim: true },
    ownerNote: { type: String, default: "", trim: true },
    ownerQrImageUrl: { type: String, default: "" },

    borrowerUpiApp: { type: String, default: "", trim: true },
    borrowerTransactionId: { type: String, default: "", trim: true },
    borrowerPaymentProofUrl: { type: String, default: "" },

    status: {
      type: String,
      enum: ["Created", "Submitted", "Confirmed"],
      default: "Created"
    }
  },
  { timestamps: true }
);

const reviewSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewForId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewerRole: { type: String, enum: ["owner", "borrower"], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "", trim: true }
  },
  { timestamps: true }
);

reviewSchema.index({ requestId: 1, reviewerId: 1 }, { unique: true });

const User = mongoose.model("User", userSchema);
const Request = mongoose.model("Request", requestSchema);
const Message = mongoose.model("Message", messageSchema);
const Verification = mongoose.model("Verification", verificationSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const Review = mongoose.model("Review", reviewSchema);

/* ---------------- BASIC ---------------- */

app.get("/", (req, res) => {
  res.send("ToolShare backend running");
});

/* ---------------- AUTH ---------------- */

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role, location } = req.body;

    if (!name || !email || !password || !role || !location) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role,
      location: normalizeLocation(location)
    });

    const token = createToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        location: user.location
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Register failed", error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = createToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        location: user.location
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

/* ---------------- AI ---------------- */

app.post("/api/ai/recommend-tool", auth, async (req, res) => {
  try {
    if (req.user.role !== "borrower") {
      return res.status(403).json({ message: "Only borrowers can use AI recommendation" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: "GEMINI_API_KEY is missing in .env" });
    }

    const { userNeed } = req.body;

    if (!userNeed || !userNeed.trim()) {
      return res.status(400).json({ message: "User need is required" });
    }

    const response = await openai.chat.completions.create({
      model: "gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are helping a tool-sharing app called ToolShare.

A borrower describes their need in natural language.
Your job is to recommend the best tool and generate a clean borrower message.

Return ONLY valid JSON in this exact format:
{
  "toolName": "string",
  "duration": "string",
  "pickupDate": "YYYY-MM-DD",
  "returnDate": "YYYY-MM-DD",
  "borrowerMessage": "string"
}

Rules:
- toolName must be short and practical
- duration must be short, like "1 week" or "2 days"
- pickupDate must be in YYYY-MM-DD format
- returnDate must be in YYYY-MM-DD format
- borrowerMessage must be polite and clear
- do not include markdown
- do not include explanation outside JSON`
        },
        {
          role: "user",
          content: userNeed.trim()
        }
      ],
      temperature: 0.3
    });

    const text = response.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        message: "AI returned invalid JSON",
        raw: text
      });
    }

    res.json({
      toolName: parsed.toolName || "",
      duration: parsed.duration || "",
      pickupDate: parsed.pickupDate || "",
      returnDate: parsed.returnDate || "",
      borrowerMessage: parsed.borrowerMessage || ""
    });
  } catch (error) {
    console.error("Gemini AI error:", error);
    return res.status(500).json({
      message: error?.message || "Gemini request failed"
    });
  }
});

/* ---------------- REQUESTS ---------------- */

app.post("/api/requests", auth, async (req, res) => {
  try {
    if (req.user.role !== "borrower") {
      return res.status(403).json({ message: "Only borrowers can create requests" });
    }

    const { toolName, duration, pickupDate, returnDate, borrowerMessage } = req.body;

    if (!toolName || !duration || !pickupDate || !returnDate) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const borrower = await User.findById(req.user.id);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    const request = await Request.create({
      borrowerId: borrower._id,
      toolName: toolName.trim(),
      duration: duration.trim(),
      pickupDate,
      returnDate,
      borrowerMessage: (borrowerMessage || "").trim(),
      location: normalizeLocation(borrower.location)
    });

    res.json({ message: "Request submitted", requestId: request._id.toString() });
  } catch (error) {
    res.status(500).json({ message: "Could not create request", error: error.message });
  }
});

app.get("/api/requests/borrower", auth, async (req, res) => {
  try {
    const rows = await Request.find({ borrowerId: req.user.id })
      .populate("acceptedOwnerId", "name email")
      .sort({ createdAt: -1 });

    res.json(
      rows.map((r) => ({
        id: r._id.toString(),
        tool_name: r.toolName,
        duration: r.duration,
        pickup_date: r.pickupDate,
        return_date: r.returnDate,
        borrower_message: r.borrowerMessage,
        status: r.status,
        owner_name: r.acceptedOwnerId ? r.acceptedOwnerId.name : ""
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Could not load borrower requests", error: error.message });
  }
});

app.get("/api/requests/owner", auth, async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owners can view this" });
    }

    const owner = await User.findById(req.user.id);
    if (!owner) {
      return res.status(404).json({ message: "Owner not found" });
    }

    const rows = await Request.find({
      $or: [
        {
          status: "Pending",
          location: normalizeLocation(owner.location),
          acceptedOwnerId: null,
          rejectedOwnerIds: { $nin: [owner._id] }
        },
        {
          acceptedOwnerId: owner._id
        }
      ]
    })
      .populate("borrowerId", "name email")
      .sort({ createdAt: -1 });

    res.json(
      rows.map((r) => ({
        id: r._id.toString(),
        tool_name: r.toolName,
        duration: r.duration,
        pickup_date: r.pickupDate,
        return_date: r.returnDate,
        borrower_name: r.borrowerId ? r.borrowerId.name : "",
        borrower_email: r.borrowerId ? r.borrowerId.email : "",
        status: r.status
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Could not load owner requests", error: error.message });
  }
});

app.get("/api/requests/:id/details", auth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate("borrowerId", "name email location")
      .populate("acceptedOwnerId", "name email location");

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isBorrower =
      request.borrowerId && request.borrowerId._id.toString() === req.user.id;
    const isOwner =
      request.acceptedOwnerId && request.acceptedOwnerId._id.toString() === req.user.id;

    if (!isBorrower && !isOwner) {
      return res.status(403).json({ message: "No access" });
    }

    res.json({
      id: request._id.toString(),
      borrowerId: request.borrowerId ? request.borrowerId._id.toString() : "",
      acceptedOwnerId: request.acceptedOwnerId ? request.acceptedOwnerId._id.toString() : "",

      tool_name: request.toolName,
      duration: request.duration,
      pickup_date: request.pickupDate,
      return_date: request.returnDate,
      borrower_message: request.borrowerMessage,
      status: request.status,

      borrower_name: request.borrowerId ? request.borrowerId.name : "",
      borrower_email: request.borrowerId ? request.borrowerId.email : "",
      borrower_location: request.borrowerId ? request.borrowerId.location : "",

      owner_name: request.acceptedOwnerId ? request.acceptedOwnerId.name : "",
      owner_email: request.acceptedOwnerId ? request.acceptedOwnerId.email : "",
      owner_location: request.acceptedOwnerId ? request.acceptedOwnerId.location : ""
    });
  } catch (error) {
    res.status(500).json({ message: "Could not load request details", error: error.message });
  }
});

app.put("/api/requests/:id/status", auth, async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owners can update requests" });
    }

    const { status } = req.body;
    const request = await Request.findById(req.params.id);
    const owner = await User.findById(req.user.id);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!owner || normalizeLocation(owner.location) !== normalizeLocation(request.location)) {
      return res.status(403).json({ message: "Not your local request" });
    }

    if (status === "Accepted") {
      if (request.status !== "Pending") {
        return res.status(400).json({ message: "Only pending requests can be accepted" });
      }

      request.status = "Accepted";
      request.acceptedOwnerId = owner._id;
      await request.save();

      return res.json({ message: "Request accepted" });
    }

    if (status === "Rejected") {
      if (request.status !== "Pending") {
        return res.status(400).json({ message: "Only pending requests can be rejected" });
      }

      const alreadyRejected = request.rejectedOwnerIds.some(
        (id) => id.toString() === owner._id.toString()
      );

      if (!alreadyRejected) {
        request.rejectedOwnerIds.push(owner._id);
      }

      const totalOwners = await User.countDocuments({
        role: "owner",
        location: normalizeLocation(request.location)
      });

      if (request.rejectedOwnerIds.length >= totalOwners) {
        request.status = "Rejected";
      }

      await request.save();
      return res.json({ message: "Request rejected" });
    }

    const allowed = ["Borrowed", "Completed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (!request.acceptedOwnerId || request.acceptedOwnerId.toString() !== owner._id.toString()) {
      return res.status(403).json({ message: "Only accepted owner can change this status" });
    }

    if (status === "Borrowed" && request.status !== "Confirmed") {
      return res.status(400).json({ message: "Request must be confirmed before marking borrowed" });
    }

    if (status === "Completed" && request.status !== "Borrowed") {
      return res.status(400).json({ message: "Request must be borrowed before marking completed" });
    }

    request.status = status;
    await request.save();

    res.json({ message: `Status updated to ${status}` });
  } catch (error) {
    res.status(500).json({ message: "Could not update status", error: error.message });
  }
});

/* ---------------- CHAT ---------------- */

app.get("/api/messages/:requestId", auth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isBorrower = request.borrowerId.toString() === req.user.id;
    const isOwner =
      request.acceptedOwnerId && request.acceptedOwnerId.toString() === req.user.id;

    if (!isBorrower && !isOwner) {
      return res.status(403).json({ message: "No access" });
    }

    const rows = await Message.find({ requestId: request._id })
      .populate("senderId", "name")
      .sort({ createdAt: 1 });

    res.json(
      rows.map((m) => ({
        id: m._id.toString(),
        requestId: m.requestId.toString(),
        senderId: m.senderId ? m.senderId._id?.toString?.() : "",
        sender_name: m.senderId ? m.senderId.name : "",
        message: m.message,
        created_at: m.createdAt
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Could not load messages", error: error.message });
  }
});

app.post("/api/messages", auth, async (req, res) => {
  try {
    const { requestId, message } = req.body;

    if (!requestId || !message) {
      return res.status(400).json({ message: "requestId and message required" });
    }

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isBorrower = request.borrowerId.toString() === req.user.id;
    const isOwner =
      request.acceptedOwnerId && request.acceptedOwnerId.toString() === req.user.id;

    if (!isBorrower && !isOwner) {
      return res.status(403).json({ message: "No access" });
    }

    const msg = await Message.create({
      requestId,
      senderId: req.user.id,
      message: message.trim()
    });

    const populated = await Message.findById(msg._id).populate("senderId", "name");

    res.json({
      message: "Message sent",
      data: {
        id: populated._id.toString(),
        requestId: populated.requestId.toString(),
        sender_name: populated.senderId ? populated.senderId.name : "",
        message: populated.message,
        created_at: populated.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Could not send message", error: error.message });
  }
});

/* ---------------- VIDEO VERIFICATION ---------------- */

app.post("/api/verifications", auth, upload.single("video"), async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can upload verification video" });
    }

    const { requestId } = req.body;
    const request = await Request.findById(requestId);

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!request.acceptedOwnerId || request.acceptedOwnerId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only accepted owner can upload verification video" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Video file required" });
    }

    const videoUrl = `/uploads/${req.file.filename}`;

    await Verification.create({
      requestId: request._id,
      uploadedBy: req.user.id,
      videoUrl
    });

    res.json({ message: "Owner verification video uploaded successfully", videoUrl });
  } catch (error) {
    res.status(500).json({ message: "Upload failed", error: error.message });
  }
});

app.get("/api/verifications/:requestId", auth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isBorrower = request.borrowerId.toString() === req.user.id;
    const isOwner =
      request.acceptedOwnerId && request.acceptedOwnerId.toString() === req.user.id;

    if (!isBorrower && !isOwner) {
      return res.status(403).json({ message: "No access" });
    }

    const videos = await Verification.find({ requestId: req.params.requestId }).sort({ createdAt: -1 });

    res.json(
      videos.map((video) => ({
        id: video._id.toString(),
        videoUrl: video.videoUrl,
        uploadedBy: video.uploadedBy.toString(),
        createdAt: video.createdAt
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Could not load verification videos", error: error.message });
  }
});

/* ---------------- PAYMENTS ---------------- */

app.post("/api/payments/setup", auth, upload.single("ownerQrImage"), async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can create payment setup" });
    }

    const { requestId, rentAmount, depositAmount, ownerUpiId, ownerNote } = req.body;
    const ownerQrImageUrl = req.file ? `/uploads/${req.file.filename}` : "";

    if (!requestId || rentAmount === undefined || depositAmount === undefined || !ownerUpiId) {
      return res.status(400).json({ message: "All payment setup fields are required" });
    }

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!request.acceptedOwnerId || request.acceptedOwnerId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only accepted owner can create payment setup" });
    }

    const existingPayment = await Payment.findOne({ requestId });
    if (existingPayment && ["Submitted", "Confirmed"].includes(existingPayment.status)) {
      return res.status(400).json({ message: "Payment setup can no longer be edited" });
    }

    const updateData = {
      requestId,
      ownerId: req.user.id,
      borrowerId: request.borrowerId,
      rentAmount: Number(rentAmount),
      depositAmount: Number(depositAmount),
      ownerUpiId: ownerUpiId.trim(),
      ownerNote: (ownerNote || "").trim(),
      status: "Created"
    };

    if (ownerQrImageUrl) {
      updateData.ownerQrImageUrl = ownerQrImageUrl;
    }

    const payment = await Payment.findOneAndUpdate(
      { requestId },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    request.status = "Payment Created";
    await request.save();

    res.json({
      message: "Payment setup created successfully",
      payment: {
        requestId: payment.requestId.toString(),
        rentAmount: payment.rentAmount,
        depositAmount: payment.depositAmount,
        ownerUpiId: payment.ownerUpiId,
        ownerNote: payment.ownerNote,
        ownerQrImageUrl: payment.ownerQrImageUrl,
        status: payment.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Could not create payment setup", error: error.message });
  }
});

app.get("/api/payments/:requestId", auth, async (req, res) => {
  try {
    const request = await Request.findById(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isBorrower = request.borrowerId.toString() === req.user.id;
    const isOwner =
      request.acceptedOwnerId && request.acceptedOwnerId.toString() === req.user.id;

    if (!isBorrower && !isOwner) {
      return res.status(403).json({ message: "No access" });
    }

    const payment = await Payment.findOne({ requestId: req.params.requestId });
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json({
      requestId: payment.requestId.toString(),
      rentAmount: payment.rentAmount,
      depositAmount: payment.depositAmount,
      ownerUpiId: payment.ownerUpiId,
      ownerNote: payment.ownerNote,
      ownerQrImageUrl: payment.ownerQrImageUrl,
      borrowerUpiApp: payment.borrowerUpiApp,
      borrowerTransactionId: payment.borrowerTransactionId,
      borrowerPaymentProofUrl: payment.borrowerPaymentProofUrl,
      status: payment.status
    });
  } catch (error) {
    res.status(500).json({ message: "Could not load payment", error: error.message });
  }
});

app.post("/api/payments/submit", auth, upload.single("proof"), async (req, res) => {
  try {
    if (req.user.role !== "borrower") {
      return res.status(403).json({ message: "Only borrower can submit payment" });
    }

    const { requestId, borrowerUpiApp, borrowerTransactionId } = req.body;

    if (!requestId || !borrowerUpiApp || !borrowerTransactionId) {
      return res.status(400).json({ message: "All payment submit fields are required" });
    }

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.borrowerId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only request borrower can submit payment" });
    }

    const payment = await Payment.findOne({ requestId });
    if (!payment) {
      return res.status(404).json({ message: "Payment setup not found" });
    }

    if (payment.status !== "Created") {
      return res.status(400).json({ message: "Payment already submitted or confirmed" });
    }

    let proofUrl = payment.borrowerPaymentProofUrl;
    if (req.file) {
      proofUrl = `/uploads/${req.file.filename}`;
    }

    payment.borrowerUpiApp = borrowerUpiApp.trim();
    payment.borrowerTransactionId = borrowerTransactionId.trim();
    payment.borrowerPaymentProofUrl = proofUrl;
    payment.status = "Submitted";
    await payment.save();

    request.status = "Payment Submitted";
    await request.save();

    res.json({ message: "Payment submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Could not submit payment", error: error.message });
  }
});

app.post("/api/payments/confirm", auth, async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only owner can confirm payment" });
    }

    const { requestId } = req.body;

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (!request.acceptedOwnerId || request.acceptedOwnerId.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only accepted owner can confirm payment" });
    }

    const payment = await Payment.findOne({ requestId });
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status !== "Submitted") {
      return res.status(400).json({ message: "Payment is not yet submitted" });
    }

    payment.status = "Confirmed";
    await payment.save();

    request.status = "Confirmed";
    await request.save();

    res.json({ message: "Payment confirmed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Could not confirm payment", error: error.message });
  }
});

/* ---------------- REVIEWS ---------------- */

app.post("/api/reviews", auth, async (req, res) => {
  try {
    const { requestId, rating, comment } = req.body;

    if (!requestId || !rating) {
      return res.status(400).json({ message: "requestId and rating are required" });
    }

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "Completed") {
      return res.status(400).json({ message: "Review allowed only after completion" });
    }

    let reviewForId = null;
    let reviewerRole = null;

    if (request.borrowerId.toString() === req.user.id) {
      if (!request.acceptedOwnerId) {
        return res.status(400).json({ message: "No owner found for this request" });
      }
      reviewForId = request.acceptedOwnerId;
      reviewerRole = "borrower";
    } else if (request.acceptedOwnerId && request.acceptedOwnerId.toString() === req.user.id) {
      reviewForId = request.borrowerId;
      reviewerRole = "owner";
    } else {
      return res.status(403).json({ message: "No access" });
    }

    const review = await Review.create({
      requestId,
      reviewerId: req.user.id,
      reviewForId,
      reviewerRole,
      rating: Number(rating),
      comment: (comment || "").trim()
    });

    res.json({ message: "Review submitted", reviewId: review._id.toString() });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "You already reviewed this request" });
    }
    res.status(500).json({ message: "Could not submit review", error: error.message });
  }
});

app.get("/api/reviews/user/:userId", auth, async (req, res) => {
  try {
    const reviews = await Review.find({ reviewForId: req.params.userId })
      .populate("reviewerId", "name role")
      .sort({ createdAt: -1 });

    const avg =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    res.json({
      averageRating: avg,
      totalReviews: reviews.length,
      reviews: reviews.map((r) => ({
        id: r._id.toString(),
        rating: r.rating,
        comment: r.comment,
        reviewer_name: r.reviewerId ? r.reviewerId.name : "",
        reviewer_role: r.reviewerRole,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Could not load reviews", error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});