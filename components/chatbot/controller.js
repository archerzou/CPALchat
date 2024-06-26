import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import ChatController from "./chatController.js";
import InputBoxComponent from "./inputBox.js";
import moment from "moment";
import axios from "axios";
import useChatInfoStore from "../../stores/chatStore.js";
import { useSessionStorage } from "../../hooks/useSessionStorage.js";
import { useLocalStorage } from "../../hooks/useLocalStorage.js";
import { v4 as uuidv4 } from "uuid";

function Controller() {
  const [isSendChatLoading, setIsSendChatLoading] = useState(false);
  const [isGetChatLoading, setIsGetChatLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState("");
  const [fileObject, setFileObject] = useState();
  const [inputText, setInputText] = useState("");
  const [streamingResponse, setStreamingResponse] = useState("");
  const chatArray = useChatInfoStore((state) => state.chatArray);
  const setChatArray = useChatInfoStore((state) => state.setChatArray);
  const addChatArray = useChatInfoStore((state) => state.addChatArray);
  const popChatArray = useChatInfoStore((state) => state.popChatArray);
  const [savedChatId, setSavedChatId] = useSessionStorage("current_chatId", "");
  const [accessToken, setAccessToken] = useSessionStorage("accessToken", "");
  const [currentClient, setCurrentClient] = useLocalStorage("client", "");
  const router = useRouter();
  const chatId = router.query.id;

  useEffect(() => {
    let intervalId;
    if (isSendChatLoading) {
      //when you send a message

      intervalId = setInterval(async () => {
        if (chatId) {
          let chatStatus = await getChatStatus(chatId);
          setResponseStatus(chatStatus);
        }
      }, 1000);
    }
    if (savedChatId !== chatId && chatId) {
      //when you switch to another chat
      console.log("tab swtiched");
      setChatArray([]);
      getChatMessages(chatId);
      setSavedChatId(chatId);
    }

    if (savedChatId === chatId && chatArray.length === 0 && chatId) {
      //when you refresh the page
      getChatMessages(chatId);
    }

    console.log("chat list", chatArray);
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [chatId, savedChatId, isSendChatLoading]);

  // Modify the sendMessageClick function to generate a new chat_id if one doesn't exist:
  const sendMessageClick = async (e) => {
    e.preventDefault();
    setIsSendChatLoading(true);

    const currentInputText = inputText;
    let chatId = router.query.id;
    setStreamingResponse("");
    setInputText("");

    if (!chatId) {
      // Generate a new chat_id
      const newChatId = generateNewChatId();

      // Update the URL with the new chat_id
      router.push(`/chatbot/${newChatId}`);

      chatId = newChatId;
    }

    sendMessageGivenChatId(currentInputText);
  };

  // Create a new function called generateNewChatId to generate a unique chat_id
  const generateNewChatId = () => {
    // Generate a unique chat_id using a suitable method
    const newChatId = uuidv4(); // using uuid v4 library
    return newChatId;
  };

  const getSourceStatus = async () => {
    let chatId = router.query.id;
    try {
      const response = await axios.get(
        `/api/chatbot/getSourceStatus?chat_id=${chatId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken || ""}`,
          },
        }
      );

      const sourceStatus = response.data.source;
      return sourceStatus;
    } catch (error) {
      return "error";
    }
  };

  // Modify the sendMessageGivenChatId function to handle the case when a new chat_id is generated
  const sendMessageGivenChatId = async (messageText) => {
    let chatId = router.query.id;
    let clientId = currentClient.uuid;
    console.log("In progress: sendMessageGivenChatId");
    const sendTime = moment().format("h:mm");
    const myMessage = { sender: "human", message: messageText, time: sendTime };
    addChatArray(myMessage);
    const encodeURIInputText = encodeURIComponent(messageText);
    console.log("THis is frontend encodeURIInputText", encodeURIInputText);

    try {
      const response = await fetch(
        `/api/chain/${chatId}/${clientId}/?message=${encodeURIComponent(
          inputText
        )}`,

        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.body)
        throw Error("ReadableStream not yet supported in this browser.");
      console.log("This is debug input text", inputText);
      const reader = response.body.getReader();

      let accumulatedResponse = "";

      reader.read().then(async function process({ done, value }) {
        if (done) {
          let sourceStatus = await getSourceStatus();
          console.log("This is source status", sourceStatus);
          let fileData;
          if (sourceStatus == "Document_Display") {
            fileData = await displayRelevantFile(
              chatId,
              inputText,
              accumulatedResponse
            );
          } else {
            fileData = await getRelevantFile(
              chatId,
              inputText,
              accumulatedResponse
            );
          }
          console.log("Final Bot Message", accumulatedResponse);
          const finalBotMessage = {
            sender: "ai",
            message: accumulatedResponse,
            time: sendTime,
            relevant_files: fileData,
            source: sourceStatus,
          };

          getChatTitle(chatId);
          console.log("this is finalBot Message", finalBotMessage);
          addChatArray(finalBotMessage);
          setIsSendChatLoading(false);
          setStreamingResponse("");

          // Update the conversation page with the new chat_id
          router.push(`/chatbot/${chatId}`);
          return;
        }

        let decodedValue = new TextDecoder("utf-8").decode(value);
        // // Check for "disp:" only if not already detected
        // console.log("this is devoded value", decodedValue);
        // if (!isDispDetected && decodedValue.startsWith("disp: ")) {
        //   let dispValues = decodedValue.split("disp: ")[1];
        //   dispValues = dispValues.replace(/\n\n$/, "");
        //   accumulatedResponse = accumulatedResponse + dispValues;
        //   isDispDetected = true;
        //   return reader.read().then(process); // Skip further processing for this chunk and continue reading
        // }
        let processedValues = decodedValue.split("data: ");

        for (let val of processedValues) {
          console.log("this is val", val);
          if (val.endsWith("\n\n")) {
            val = val.slice(0, -2); // Remove the ending newline characters
          }
          accumulatedResponse = accumulatedResponse + val;
        }

        setStreamingResponse(accumulatedResponse);

        return reader.read().then(process); // Continue processing the stream
      });
    } catch (error) {
      console.log("error occured");
      popChatArray();
      setStreamingResponse("");
      const errorMessage = {
        sender: "ai",
        message: "Sorry, something went wrong. Please try again.",
        time: sendTime,
      };
      addChatArray(errorMessage); // Add error message to chat array
    }
  };

  async function getChatStatus(chatId) {
    try {
      const response = await axios.get(
        `/api/chatbot/getChatStatus?chat_id=${chatId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken || ""}`,
          },
        }
      );
      const chatStatus = response.data.chatStatus;
      return chatStatus;
    } catch (error) {
      return "";
    }
  }

  async function displayRelevantFile(chatId, inputText, aiResponse) {
    let clientId = currentClient.uuid;
    const body = {
      chat_id: chatId,
      client_id: clientId,
      human_message: inputText,
      ai_message: aiResponse,
    };
    try {
      const response = await axios.post(
        "/api/chatbot/getDisplayRelevantFile",
        body,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (response.status === 200) {
        const releventFile = response.data;
        console.log("Relevent file is : ", releventFile);
        setFileObject(releventFile);
        return releventFile;
      }
    } catch (error) {
      return setFileObject({
        file_id: -1,
        file_name: "No relevant file found",
      });
    }
  }

  async function getRelevantFile(chatId, inputText, aiResponse) {
    let clientId = currentClient.uuid;
    console.log("getRelevantFile");
    console.log("chatId", chatId);
    console.log("inputText", inputText);
    console.log("aiResponse", aiResponse);
    const body = {
      chat_id: chatId,
      client_id: clientId,
      human_message: inputText,
      ai_message: aiResponse,
    };
    try {
      const response = await axios.post("/api/chatbot/getRelevantFile", body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (response.status === 200) {
        const releventFile = response.data;
        console.log("Relevent file is : ", releventFile);
        setFileObject(releventFile);
        return releventFile;
      }
    } catch (error) {
      return setFileObject({
        file_id: -1,
        file_name: "No relevant file found",
      });
    }
  }

  async function getChatMessages(chatId) {
    setIsGetChatLoading(true);
    console.log("setIsGetChatLoading : true");
    try {
      const response = await axios.get(
        `/api/chatbot/getChatMessage?chat_id=${chatId}`,

        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const messages = response.data;
      setChatArray(messages);
    } catch (error) {
      console.error("Error getting new chat ID", error);
      return [];
    } finally {
      setIsGetChatLoading(false);
      console.log("setIsGetChatLoading : false");
    }
  }

  async function setNewChatId() {
    //when first time open the chatbot
    try {
      console.log("chatid Not found running setNewChatId");
      const response = await axios.get("/api/chatbot/postCreateNewChat", {
        headers: {
          Authorization: `Bearer ${accessToken || ""}`,
        },
      });
      const chatId = response.data.chat_id;
      sessionStorage.setItem("current_chatId", chatId);
      // router.push(`/chatbot/${chatId}`, undefined, { shallow: true });

      return chatId;
    } catch (error) {
      console.error("Error getting new chat ID", error);
      return;
    }
  }

  async function getChatTitle(id) {
    try {
      console.log("Function : UpdateChatTitle ");
      const response = await axios.post(
        "/api/chatbot/getChatTitle",
        { chat_id: id },
        {
          headers: {
            Authorization: `Bearer ${accessToken || ""}`,
          },
        }
      );
      //refresh
    } catch (error) {
      console.error("Error getting new chat ID", error);
    }
  }

  // Simplified the function by using a try-catch block to handle errors.
  const handleRefresh = async () => {
    try {
      const response = await axios.get("/api/chatbot/getClearChatHistory", {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("accessToken")}`,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 200) {
        setChatArray([]);
        alert("Successfully cleared history");
      } else {
        throw new Error("Failed to clear history");
      }
    } catch (error) {
      alert("Failed to clear history");
      console.error(error);
    }
  };

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="flex-1 overflow-auto">
        <ChatController
          inputText={inputText}
          isSendChatLoading={isSendChatLoading}
          isGetChatLoading={isGetChatLoading}
          streamingResponse={streamingResponse}
          messages={chatArray}
          responseStatus={responseStatus}
          setInputText={setInputText}
          handleClick={sendMessageClick}
        />
      </div>
      <div className="flex-shrink-0">
        <InputBoxComponent
          messageLength={chatArray.length}
          inputText={inputText}
          setInputText={setInputText}
          isSendChatLoading={isSendChatLoading}
          isGetChatLoading={isGetChatLoading}
          handleClick={sendMessageClick}
          handleRefresh={handleRefresh}
        />
      </div>
    </div>
  );
}

export default Controller;
